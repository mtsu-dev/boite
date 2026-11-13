# Voice dictation

The microphone beside Send turns speech into text in the message box, for any
agent. The text waits there until you send it: dictation never sends a prompt
by itself.

## Set it up

1. Open Settings, Input, Voice on the machine that hosts the conversation. The line
   at the top says whether dictation works now.
2. Press Set up dictation. Boite downloads the local engine and its model in
   one click. New setups use Local with Nemotron Streaming.
3. To use an API instead, pick API under Engine, choose Groq or OpenRouter,
   paste your key and press Save keys.

The owner of the machine chooses the engine and keys. A paired phone dictates
through the same machine but cannot change its setup.

## Dictate

1. Press the microphone (Dictate) beside Send. A small menu floats beside the
   message box with a live spectrum and the elapsed time.
2. Speak. A live preview shows what was heard so far.
3. Press the same button again (Finish dictation). The text goes after what
   is already in the box, including what you typed while recording.

- Escape or the bin (Discard recording) throws the recording away.
- A recording lasts two minutes at most.
- Switching conversations, leaving the page or hiding the app stops the
  microphone.
- If transcription fails, Retry transcription tries again with the same
  audio while the message box stays open.

## Local or API

| | Local | API |
| --- | --- | --- |
| Where audio goes | Stays on the machine running Boite | Sent to Groq or OpenRouter with your key |
| What it needs | A download, once | A key from the provider |
| Model | Your choice, below | Whisper Large v3 Turbo |
| Retention | None: Boite keeps no audio or transcript | The provider's own policy |

With both API keys saved, Fall back to the other provider retries on the
other one when the first fails. Local never falls back to an API.

### Local models

| Model | Size | Notes |
| --- | --- | --- |
| Nemotron Streaming (default) | 682 MB | Transcribes live in many languages, French included |
| Whistle | 17 MB | English, French, German, Spanish, Italian, Dutch and Polish |
| Whisper Large v3 Turbo | 574 MB | Kept for compatibility |

- One model is in use at a time. Picking one that is not downloaded downloads
  it first. Each model has its own remove button.
- Add from a link takes an https link to a whisper.cpp ggml model, such as
  one on Hugging Face.
- Advanced takes a Whisper executable and a Model file of your own. A model
  file set there wins over the list.
- Whisper downloads its own runtime on Windows x64. On other systems it needs
  `whisper-cli` on your PATH, or its path under Advanced.

### Language

Leave Language empty to detect the language. A two-letter code such as `en`
or `fr` fixes it.

## Microphone access

- In a browser, the microphone needs HTTPS or localhost. A plain HTTP address
  on your local network does not work: open the machine through its HTTPS
  address, as when you set up a phone.
- The Linux desktop app cannot dictate yet, since its webview does not grant
  the microphone. Open Boite in a browser to dictate there.
- Boite asks for permission only when you press Dictate or Test microphone.
  If you denied it, allow it in your browser or system settings, then try
  again.
- Microphone in Settings, Input, Voice picks the input on this device, phones
  included. System default follows the system's input.
- Test microphone shows the input level. The test stays on your device.

## Turn it off

Voice dictation in Settings, Input, Voice turns dictation off on this device. The
microphone leaves the message bar, and the installed model stays for later.

## Limits

- Silent or very short recordings are refused before they are sent.
- One local transcription, or two API ones, run at a time. A request beyond
  that fails and can be retried.
- A machine running an older Boite asks you to update it first.

## Going further

- [Phone](phone.md): pair a phone and open Boite over HTTPS.
- [Server](server.md): run Boite on another machine.
- [Privacy](privacy.md): what leaves your machine.
- Technical reference: [voice](internals/voice.md).
