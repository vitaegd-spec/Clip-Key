/**
 * Virtual keyboard — native typing via Win32 SendInput.
 *
 * Modified for Murphy's fork (new file, Apache-2.0 §4(b)).
 *
 * Why SendInput + KEYEVENTF_UNICODE instead of clipboard + Ctrl+V (the emoji
 * path): typing never touches the user's clipboard or the history watcher,
 * works for any character regardless of keyboard layout, and line breaks
 * arrive as real Enter presses. If the native call is unavailable the IPC
 * layer falls back to the clipboard paste path.
 *
 * koffi is already a project dependency (window.ts, fullscreen.ts, formats.ts).
 */
import koffi from 'koffi'
import { encodeKeyStrokes } from '../../shared/virtualKeys'

type SendInputFn = (count: number, inputs: unknown[], size: number) => number
type GetLastErrorFn = () => number

const INPUT_KEYBOARD = 1
const ERROR_ACCESS_DENIED = 5
/** Events per SendInput call — keeps long signatures from flooding the input queue at once. */
const CHUNK = 200

let sendInputFn: SendInputFn | null = null
let getLastErrorFn: GetLastErrorFn | null = null
let inputSize = 0
let loadAttempted = false

function load(): boolean {
  if (sendInputFn) return true
  if (loadAttempted || process.platform !== 'win32') return false
  loadAttempted = true
  try {
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    const MOUSEINPUT = koffi.struct('VK_MOUSEINPUT', {
      dx: 'int32',
      dy: 'int32',
      mouseData: 'uint32',
      dwFlags: 'uint32',
      time: 'uint32',
      dwExtraInfo: 'uintptr_t'
    })
    const KEYBDINPUT = koffi.struct('VK_KEYBDINPUT', {
      wVk: 'uint16',
      wScan: 'uint16',
      dwFlags: 'uint32',
      time: 'uint32',
      dwExtraInfo: 'uintptr_t'
    })
    const HARDWAREINPUT = koffi.struct('VK_HARDWAREINPUT', {
      uMsg: 'uint32',
      wParamL: 'uint16',
      wParamH: 'uint16'
    })
    const INPUT_UNION = koffi.union('VK_INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT })
    const INPUT = koffi.struct('VK_INPUT', { type: 'uint32', u: INPUT_UNION })
    inputSize = koffi.sizeof(INPUT)
    sendInputFn = user32.func('uint32 __stdcall SendInput(uint32 cInputs, VK_INPUT *pInputs, int cbSize)') as SendInputFn
    getLastErrorFn = kernel32.func('uint32 __stdcall GetLastError()') as GetLastErrorFn
    console.log(`[VirtualKeyboard] SendInput loaded via koffi (INPUT=${inputSize} bytes)`)
    return true
  } catch (err) {
    console.error('[VirtualKeyboard] koffi SendInput load failed — clipboard fallback will be used:', err)
    sendInputFn = null
    return false
  }
}

export function nativeTypingAvailable(): boolean {
  return load()
}

export type NativeTypeResult =
  | { ok: true; typed: number }
  | { ok: false; error: 'unavailable' | 'blocked' | 'failed'; sentEvents: number }

/** Type `text` into whatever window currently holds keyboard focus. */
export function typeTextNative(text: string): NativeTypeResult {
  if (!load() || !sendInputFn) return { ok: false, error: 'unavailable', sentEvents: 0 }
  const strokes = encodeKeyStrokes(text)
  let sentEvents = 0
  for (let i = 0; i < strokes.length; i += CHUNK) {
    const part = strokes.slice(i, i + CHUNK).map((s) => ({
      type: INPUT_KEYBOARD,
      u: { ki: { wVk: s.vk, wScan: s.scan, dwFlags: s.flags, time: 0, dwExtraInfo: 0 } }
    }))
    let sent = 0
    try {
      sent = sendInputFn(part.length, part, inputSize)
    } catch (err) {
      console.error('[VirtualKeyboard] SendInput threw:', err)
      return { ok: false, error: 'failed', sentEvents }
    }
    sentEvents += sent
    if (sent !== part.length) {
      const code = getLastErrorFn?.() ?? 0
      console.warn(`[VirtualKeyboard] SendInput delivered ${sent}/${part.length} (lastError=${code})`)
      // UIPI: a non-elevated process cannot inject into an elevated window.
      return { ok: false, error: code === ERROR_ACCESS_DENIED || sent === 0 ? 'blocked' : 'failed', sentEvents }
    }
  }
  return { ok: true, typed: text.length }
}
