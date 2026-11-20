import argparse
from hashlib import sha256
from pathlib import Path
from struct import unpack_from
from urllib.request import urlretrieve
from uuid import UUID


class Image:
    def __init__(self, data):
        self.data = data
        nt, = unpack_from("<I", data, 0x3c)
        if data[:2] != b"MZ" or data[nt:nt + 4] != b"PE\0\0":
            raise ValueError("Expected an MZ/PE image")
        self.machine, count, self.timestamp = unpack_from("<HHI", data, nt + 4)
        size, = unpack_from("<H", data, nt + 20)
        self.optional = nt + 24
        if self.machine != 0x8664 or data[self.optional:self.optional + 2] != b"\x0b\x02":
            raise ValueError("Expected AMD64 PE32+")
        self.size, = unpack_from("<I", data, self.optional + 56)
        self.sections = []
        for i in range(count):
            name, virtual_size, address, raw_size, raw = unpack_from("<8sIIII", data, self.optional + size + i * 40)
            self.sections.append((name.rstrip(b"\0"), virtual_size, address, raw_size, raw))

    def at(self, rva, length):
        for _, virtual_size, address, raw_size, raw in self.sections:
            if address <= rva and rva + length <= address + min(virtual_size, raw_size):
                offset = raw + rva - address
                if offset + length <= len(self.data):
                    return self.data[offset:offset + length]
        raise ValueError(f"Cannot read RVA {rva:#x} length {length}")

    def directory(self, index):
        address, size = unpack_from("<II", self.data, self.optional + 112 + index * 8)
        return self.at(address, size)

    def pdb(self):
        directory = self.directory(6)
        records = []
        for cursor in range(0, len(directory), 28):
            kind, size, rva = unpack_from("<III", directory, cursor + 12)
            if kind == 2:
                data = self.at(rva, size)
                if data[:4] == b"RSDS" and len(data) >= 25:
                    records.append((UUID(bytes_le=data[4:20]), unpack_from("<I", data, 20)[0], data[24:].split(b"\0", 1)[0].decode()))
        if len(records) != 1:
            raise ValueError(f"Expected one RSDS record, found {records}")
        return records[0]

    def function(self, section, offset):
        name, _, address, _, _ = self.sections[section - 1]
        if name != b".text":
            raise ValueError(f"Expected .text, found {name}")
        start = address + offset
        table = self.directory(3)
        matches = [unpack_from("<III", table, i) for i in range(0, len(table), 12) if unpack_from("<I", table, i)[0] == start]
        if len(matches) != 1:
            raise ValueError(f"Expected one unwind entry for {start:#x}, found {matches}")
        _, end, unwind = matches[0]
        return start, end, unwind, self.at(start, end - start)


def pdb_streams(data):
    if not data.startswith(b"Microsoft C/C++ MSF 7.00\r\n\x1aDS\0\0\0"):
        raise ValueError("Expected an MSF 7 PDB")
    block, _, blocks, length, _, block_map = unpack_from("<6I", data, 32)
    if block not in (512, 1024, 2048, 4096) or blocks * block != len(data):
        raise ValueError("Invalid PDB block size or count")

    def read_blocks(indices, length):
        if any(i >= blocks for i in indices):
            raise ValueError("Invalid PDB block number")
        return b"".join(data[i * block:(i + 1) * block] for i in indices)[:length]

    directory = read_blocks(unpack_from(f"<{(length + block - 1) // block}I", data, block_map * block), length)
    count, = unpack_from("<I", directory)
    sizes = unpack_from(f"<{count}I", directory, 4)
    offset = 4 + 4 * count
    streams = []
    for size in sizes:
        num = 0 if size == 0xffffffff else (size + block - 1) // block
        streams.append(read_blocks(unpack_from(f"<{num}I", directory, offset), size))
        offset += num * 4
    return streams


def loader_symbol(data, guid, age):
    streams = pdb_streams(data)
    info_age, = unpack_from("<I", streams[1], 8)
    dbi_age, = unpack_from("<I", streams[3], 8)
    if UUID(bytes_le=streams[1][12:28]) != guid or dbi_age != age:
        raise ValueError("PDB GUID or DBI age does not match the PE RSDS record")
    index, = unpack_from("<H", streams[3], 20)
    records = streams[index]
    cursor = 0
    matches = set()
    while cursor < len(records):
        length, kind = unpack_from("<HH", records, cursor)
        end = cursor + 2 + length
        if length < 2 or end > len(records):
            raise ValueError("Invalid PDB symbol record")
        if kind == 0x110e and records[cursor + 14:end].split(b"\0", 1)[0] == b"LdrpDoDebuggerBreak":
            offset, section = unpack_from("<IH", records, cursor + 8)
            matches.add((section, offset))
        cursor = end
    if len(matches) != 1:
        raise ValueError(f"Expected one LdrpDoDebuggerBreak public symbol, found {matches}")
    return info_age, dbi_age, *matches.pop()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("--pdb", type=Path)
    parser.add_argument("--download-pdb", type=Path)
    args = parser.parse_args()
    data = args.image.read_bytes()
    image = Image(data)
    guid, age, name = image.pdb()
    print(f"NWP image-sha256={sha256(data).hexdigest()} machine={image.machine:#x} timestamp={image.timestamp:#x} image-size={image.size:#x}")
    print(f"NWP rsds-guid={guid} rsds-age={age} pdb={name}")
    pdb_path = args.pdb or args.download_pdb
    if not pdb_path:
        return
    if args.download_pdb:
        if name != "ntdll.pdb":
            raise ValueError(f"Unexpected symbol file {name}")
        url = f"https://msdl.microsoft.com/download/symbols/ntdll.pdb/{guid.hex.upper()}{age:X}/ntdll.pdb"
        print(f"NWP symbol-url={url}", flush=True)
        urlretrieve(url, args.download_pdb)
    pdb = pdb_path.read_bytes()
    info_age, dbi_age, section, offset = loader_symbol(pdb, guid, age)
    start, end, unwind, code = image.function(section, offset)
    print(f"NWP pdb-sha256={sha256(pdb).hexdigest()} pdb-info-age={info_age} pdb-dbi-age={dbi_age}")
    print(f"NWP loader section={section} section-offset={offset:#x} start={start:#x} end={end:#x} unwind={unwind:#x}")
    print(f"NWP loader-int3-rvas={','.join(hex(start + i) for i, byte in enumerate(code) if byte == 0xcc)}")
    print(f"NWP loader-bytes={code.hex()}")


if __name__ == "__main__":
    main()
