# Programmable Virtual Keyboard (Murphy's fork)

A keyboard view inside the Edge-Drop shelf. Every key is created by you. Nothing is predefined.

## Use
- Open the shelf, then click the **keyboard toggle** next to the emoji toggle.
- **+** adds a key. The label is optional; the text can be a single character (`å`) or a multi-line block (`Kind Regards,` / `Murphy`).
- **Click a key** to type its text into the app you are working in. The shelf stays open, so you can press several keys in a row.
- **Right-click a key**, or turn on ✎ Edit mode, to change, reorder (◀ ▶) or delete it.
- In the editor: a new line is typed as Enter, a tab as Tab. Ctrl+Enter saves and Esc cancels.

## How it works
| Layer | File |
|---|---|
| Model + encoder (pure) | `shared/virtualKeys.ts` |
| Persistence (`%APPDATA%\Edge-Drop\virtual-keys.json`) | `electron/store/virtualKeys.ts` |
| Native typing (Win32 `SendInput` + `KEYEVENTF_UNICODE`, via koffi) | `electron/main/virtualKeyboard.ts` |
| IPC `vkeys:list` / `vkeys:save` / `vkeys:type` | `shared/ipc.ts`, `shared/bridge.ts`, `electron/preload/index.ts`, `electron/main/ipc.ts` |
| View state | `src/store/appStore.ts` (`keyboardOpen`) |
| UI | `src/components/KeyboardPanel.tsx`, `src/styles/keyboard.css`, `Header.tsx`, `Panel.tsx`, `icons.tsx` |

Typing goes through the same focus rule as every paste in the app (`resolvePasteTarget`). The text is typed directly, so your clipboard is never touched. The only exception is a fallback: if native typing can't load, the key's text is put on the clipboard and pasted with Ctrl+V, as the emoji picker does.
Windows does not allow a normal app to type into apps running as Administrator.

## Licence
Edge-Drop is Apache-2.0. Keep `LICENSE`. Every new or changed file carries a "Modified for Murphy's fork" notice.
