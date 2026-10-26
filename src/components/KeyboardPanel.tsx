/**
 * KeyboardPanel — programmable virtual keyboard view.
 *
 * Modified for Murphy's fork (new file, Apache-2.0 §4(b)).
 *
 * - No keys are predefined: the user creates every key.
 * - Clicking a key types its text into the app the user is working in
 *   (main process: vkeys:type → SendInput, clipboard fallback). The shelf
 *   stays open so several keys can be pressed in a row.
 * - Right-click a key (or use Edit mode) to change its label/text, reorder
 *   or delete it. "+" adds a new key.
 *
 * Focus model (same contract as ShelfSearch): the shelf is NOACTIVATE and
 * never takes OS focus, so key presses land in the user's app. Only while
 * the key editor is open do its inputs engage OS focus (window focusable +
 * global hotkey paused); closing the editor — or the panel — hands it back.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from '../store/appStore'
import { edge } from '../lib/edge'
import { noteSearchEngaged } from '../lib/searchFocus'
import { playButtonClickSound } from '../lib/soundEffects'
import { useTranslation } from '../i18n'
import { CloseIcon, PencilIcon, PlusIcon, ChevronLeftIcon, ChevronRightIcon, TrashIcon } from './icons'
import {
  VIRTUAL_KEY_LIMITS,
  createVirtualKeyId,
  virtualKeyCaption,
  type VirtualKey,
  type VirtualKeyTypeResult
} from '../../shared/virtualKeys'
import '../styles/keyboard.css'

export interface KeyboardPanelProps {
  active: boolean
  isHorizontal?: boolean
}

type Draft = { index: number; key: VirtualKey; isNew: boolean }

const ERROR_TEXT: Record<NonNullable<VirtualKeyTypeResult['error']>, string> = {
  empty: 'This key has no text yet — right-click to edit it',
  'no-target': 'Click into the app you want to type in, then try again',
  blocked: 'Windows blocked typing — the target app runs as Administrator',
  busy: 'Still typing the previous key',
  failed: 'Could not type the text'
}

export function KeyboardPanel({ active, isHorizontal = false }: KeyboardPanelProps) {
  const { t } = useTranslation()
  const tr = useCallback((key: string, fallback: string) => {
    const v = t(key)
    return v === key ? fallback : v
  }, [t])
  const pushToast = useStore((s) => s.pushToast)

  const [keys, setKeys] = useState<VirtualKey[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [firedId, setFiredId] = useState<string | null>(null)
  const statusTimer = useRef<number | undefined>(undefined)
  const engagedRef = useRef(false)
  const textRef = useRef<HTMLTextAreaElement>(null)

  /* ------------------------------------------------------------------ */
  /* OS focus hand-over for the editor inputs (mirrors ShelfSearch)      */
  /* ------------------------------------------------------------------ */
  const engage = useCallback(() => {
    if (engagedRef.current) return
    engagedRef.current = true
    noteSearchEngaged(true)
    try { window.focus() } catch { /* ignore */ }
    try { void edge.focusWindow(true)?.catch?.(() => {}) } catch { /* ignore */ }
    try { void edge.pauseHotkey(true)?.catch?.(() => {}) } catch { /* ignore */ }
  }, [])

  const disengage = useCallback(() => {
    if (!engagedRef.current) return
    engagedRef.current = false
    noteSearchEngaged(false)
    try { void edge.focusWindow(false)?.catch?.(() => {}) } catch { /* ignore */ }
    try { void edge.pauseHotkey(false)?.catch?.(() => {}) } catch { /* ignore */ }
  }, [])

  useEffect(() => () => disengage(), [disengage])

  /* ------------------------------------------------------------------ */
  /* Data                                                                */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    let alive = true
    Promise.resolve(edge.listVirtualKeys())
      .then((list) => {
        if (alive && Array.isArray(list)) setKeys(list)
      })
      .catch((err) => console.error('[Keyboard] load failed', err))
      .finally(() => alive && setLoaded(true))
    return () => {
      alive = false
      window.clearTimeout(statusTimer.current)
    }
  }, [])

  const flash = useCallback((ok: boolean, msg: string) => {
    setStatus({ ok, msg })
    window.clearTimeout(statusTimer.current)
    statusTimer.current = window.setTimeout(() => setStatus(null), ok ? 1400 : 3200)
  }, [])

  const persist = useCallback(async (next: VirtualKey[]) => {
    setKeys(next)
    try {
      const saved = await edge.saveVirtualKeys(next)
      if (Array.isArray(saved)) setKeys(saved)
    } catch (err) {
      console.error('[Keyboard] save failed', err)
      pushToast({ id: `vk-save-${Date.now()}`, message: tr('keyboard.saveFailed', 'Could not save keys'), tone: 'error' })
    }
  }, [pushToast, tr])

  /* ------------------------------------------------------------------ */
  /* Editor                                                              */
  /* ------------------------------------------------------------------ */
  const closeEditor = useCallback(() => {
    setDraft(null)
    disengage()
  }, [disengage])

  // Leaving the view (filter / emoji / panel close) drops any open editor.
  useEffect(() => {
    if (!active) {
      setEditMode(false)
      closeEditor()
    }
  }, [active, closeEditor])

  const openEditor = (key?: VirtualKey) => {
    if (key) {
      setDraft({ index: keys.findIndex((k) => k.id === key.id), key: { ...key }, isNew: false })
    } else {
      setDraft({ index: keys.length, key: { id: createVirtualKeyId(), label: '', text: '' }, isNew: true })
    }
  }

  const saveDraft = () => {
    if (!draft) return
    const next = [...keys]
    if (draft.isNew) next.push(draft.key)
    else if (draft.index >= 0) next[draft.index] = draft.key
    void persist(next)
    closeEditor()
  }

  const deleteDraft = () => {
    if (!draft) return
    if (!draft.isNew) void persist(keys.filter((k) => k.id !== draft.key.id))
    closeEditor()
  }

  const moveDraft = (delta: -1 | 1) => {
    if (!draft || draft.isNew) return
    const i = draft.index
    const j = i + delta
    if (i < 0 || j < 0 || j >= keys.length) return
    const next = [...keys]
    ;[next[i], next[j]] = [next[j], next[i]]
    void persist(next)
    setDraft({ ...draft, index: j })
  }

  /* ------------------------------------------------------------------ */
  /* Typing                                                              */
  /* ------------------------------------------------------------------ */
  const fire = async (key: VirtualKey) => {
    if (editMode) {
      openEditor(key)
      return
    }
    setFiredId(key.id)
    window.setTimeout(() => setFiredId((cur) => (cur === key.id ? null : cur)), 170)
    try {
      const res = await edge.typeVirtualKey(key.id)
      if (res?.ok) {
        const n = res.typed ?? 0
        flash(true, n === 1 ? tr('keyboard.typedOne', 'Typed 1 character') : `${tr('keyboard.typedMany', 'Typed')} ${n}`)
      } else if (res?.error !== 'busy') {
        flash(false, tr(`keyboard.error.${res?.error ?? 'failed'}`, ERROR_TEXT[res?.error ?? 'failed']))
      }
    } catch (err) {
      console.error('[Keyboard] type failed', err)
      flash(false, ERROR_TEXT.failed)
    }
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  const noFocus = (e: ReactMouseEvent | ReactPointerEvent) => e.preventDefault()

  return (
    <div className={`vkb${isHorizontal ? ' vkb--horizontal' : ''}`}>
      <div className="vkb-toolbar">
        <span className="vkb-title">{tr('keyboard.title', 'Keyboard')}</span>
        <span className="vkb-count">{keys.length}</span>
        <div className="vkb-spacer" />
        <button
          type="button"
          className={`vkb-tool${editMode ? ' active' : ''}`}
          aria-pressed={editMode}
          title={editMode ? tr('keyboard.done', 'Done editing') : tr('keyboard.edit', 'Edit keys')}
          aria-label={editMode ? tr('keyboard.done', 'Done editing') : tr('keyboard.edit', 'Edit keys')}
          disabled={keys.length === 0}
          onPointerDown={noFocus}
          onMouseDown={noFocus}
          onClick={() => {
            playButtonClickSound()
            setEditMode((v) => !v)
          }}
        >
          <PencilIcon width={13} height={13} />
        </button>
        <button
          type="button"
          className="vkb-tool"
          title={tr('keyboard.add', 'Add key')}
          aria-label={tr('keyboard.add', 'Add key')}
          onPointerDown={noFocus}
          onMouseDown={noFocus}
          onClick={() => {
            playButtonClickSound()
            openEditor()
          }}
        >
          <PlusIcon width={13} height={13} />
        </button>
      </div>

      {loaded && keys.length === 0 ? (
        <div className="vkb-empty">
          <span>{tr('keyboard.empty', 'No keys yet. Every key is yours to program.')}</span>
          <button
            type="button"
            className="vkb-btn primary"
            onPointerDown={noFocus}
            onMouseDown={noFocus}
            onClick={() => {
              playButtonClickSound()
              openEditor()
            }}
          >
            {tr('keyboard.addFirst', 'Add your first key')}
          </button>
        </div>
      ) : (
        <div className={`vkb-grid${editMode ? ' editing' : ''}`} role="group" aria-label={tr('keyboard.title', 'Keyboard')}>
          {keys.map((k) => {
            const caption = virtualKeyCaption(k)
            return (
              <button
                key={k.id}
                type="button"
                className={`vkb-key${caption ? '' : ' blank'}${firedId === k.id ? ' fired' : ''}`}
                title={k.text ? (k.text.length > 300 ? `${k.text.slice(0, 300)} …` : k.text) : tr('keyboard.unassigned', 'Not assigned')}
                onPointerDown={noFocus}
                onMouseDown={noFocus}
                onClick={() => void fire(k)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  openEditor(k)
                }}
              >
                <span className="vkb-key-cap">{caption || '·'}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className={`vkb-status${status ? (status.ok ? ' ok' : ' err') : ''}`} aria-live="polite">
        {status?.msg ?? (editMode ? tr('keyboard.editHint', 'Click a key to edit it') : '')}
      </div>

      {draft && (
        <div
          className="vkb-editor"
          role="dialog"
          aria-label={draft.isNew ? tr('keyboard.newKey', 'New key') : tr('keyboard.editKey', 'Edit key')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              closeEditor()
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              saveDraft()
            }
          }}
        >
          <div className="vkb-editor-head">
            <span>{draft.isNew ? tr('keyboard.newKey', 'New key') : tr('keyboard.editKey', 'Edit key')}</span>
            <button
              type="button"
              className="vkb-tool"
              aria-label={tr('header.close', 'Close')}
              onClick={closeEditor}
            >
              <CloseIcon width={11} height={11} />
            </button>
          </div>
          <div className="vkb-editor-body">
            <label className="vkb-field vkb-field--label">
              <span>{tr('keyboard.labelField', 'Label (optional)')}</span>
              <input
                type="text"
                maxLength={VIRTUAL_KEY_LIMITS.maxLabel}
                placeholder="å  ·  Sig"
                value={draft.key.label}
                spellCheck={false}
                onPointerDown={engage}
                onFocus={engage}
                onChange={(e) => setDraft({ ...draft, key: { ...draft.key, label: e.target.value } })}
              />
            </label>
            <label className="vkb-field vkb-field--text">
              <span>{tr('keyboard.textField', 'Text to type')}</span>
              <textarea
                ref={textRef}
                rows={isHorizontal ? 2 : 4}
                maxLength={VIRTUAL_KEY_LIMITS.maxText}
                placeholder={'å\nKind Regards,\nMurphy'}
                value={draft.key.text}
                spellCheck={false}
                onPointerDown={engage}
                onFocus={engage}
                onChange={(e) => setDraft({ ...draft, key: { ...draft.key, text: e.target.value } })}
              />
            </label>
          </div>
          <div className="vkb-hint">{tr('keyboard.hint', 'New lines type as Enter · Ctrl+Enter saves · Esc cancels')}</div>
          <div className="vkb-actions">
            {!draft.isNew && (
              <>
                <button
                  type="button"
                  className="vkb-btn icon"
                  title={tr('keyboard.moveLeft', 'Move left')}
                  aria-label={tr('keyboard.moveLeft', 'Move left')}
                  disabled={draft.index <= 0}
                  onClick={() => moveDraft(-1)}
                >
                  <ChevronLeftIcon width={12} height={12} />
                </button>
                <button
                  type="button"
                  className="vkb-btn icon"
                  title={tr('keyboard.moveRight', 'Move right')}
                  aria-label={tr('keyboard.moveRight', 'Move right')}
                  disabled={draft.index >= keys.length - 1}
                  onClick={() => moveDraft(1)}
                >
                  <ChevronRightIcon width={12} height={12} />
                </button>
                <button
                  type="button"
                  className="vkb-btn icon danger"
                  title={tr('keyboard.delete', 'Delete key')}
                  aria-label={tr('keyboard.delete', 'Delete key')}
                  onClick={deleteDraft}
                >
                  <TrashIcon width={12} height={12} />
                </button>
              </>
            )}
            <div className="vkb-spacer" />
            <button type="button" className="vkb-btn" onClick={closeEditor}>
              {tr('keyboard.cancel', 'Cancel')}
            </button>
            <button type="button" className="vkb-btn primary" onClick={saveDraft}>
              {tr('keyboard.save', 'Save')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
