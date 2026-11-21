/*
 * `deny-syscall <number>[:zero|:nonzero] <command> [args...]`: runs the
 * command, and all it starts, under a seccomp filter that fails that one
 * syscall with EPERM, as a container's filter can on a kernel that has it;
 * with `:zero` or `:nonzero` only when its second argument (a signal, for
 * pidfd_send_signal) is or is not 0. linux-launcher.test.ts runs a core or a
 * guard under it to check what each does without pidfd support.
 */
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <unistd.h>

#if defined(__x86_64__)
#define ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define ARCH AUDIT_ARCH_AARCH64
#else
#error "deny-syscall: unknown architecture"
#endif

int main(int argc, char **argv) {
  if (argc < 3) return 2;
  char *mode = NULL;
  unsigned number = (unsigned)strtoul(argv[1], &mode, 10);
  /* Which second arguments are refused: every one, only 0, or all but 0 (the low 32 bits, an int signal). */
  int zero = strcmp(mode, ":zero") == 0, nonzero = strcmp(mode, ":nonzero") == 0;
  if (*mode != '\0' && !zero && !nonzero) return 2;
  struct sock_filter code[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, number, 0, 4),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
    /* Refuse when: any (both ways jump to the refusal), zero (refuse when equal), nonzero (refuse when not equal). */
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, nonzero ? 1 : 0, zero ? 1 : 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog program = { sizeof code / sizeof code[0], code };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0 || prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) != 0) return 3;
  execvp(argv[2], argv + 2);
  return 127;
}
