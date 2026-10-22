'use client';

import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import {Icon, Check, Copy, Hide, Show, Wrap} from '#/components/glaze/icon.tsx';
import {Button} from '#/components/glaze/ui/button.tsx';
import {cn} from '#/lib/glaze/utils.ts';

// Glaze's code: a file or excerpt (CodeBlock), or shell commands with their output (variant="command"). Both sit on
// code-surface, paper with the panel's hairline, on the 10px corner of a box that holds lines of text. Mono is
// type-code-block, 12px on a 20px line: a block has no sans beside it to match, so the inline 0.8 scale does not apply.
//
// A file has a header row on the same surface: the filename in mono (or the language in words), then a wrap toggle and
// copy as ghost icon buttons, over a hairline. Line numbers sit in a gutter that selection and copy skip; a
// highlighted line takes the pressed wash, never a bar on its edge.
//
// Syntax is ink at its steps, never a rainbow: colour means status in Glaze, and code is not status. Identifiers,
// keys and numbers are text-1, keywords text-1 at 500, strings text-1, punctuation and comments text-2.
//
// The detail from the job: copy takes what a person would run. In a command block the prompt and the printed output
// are never copied, and a secret shown as dots copies its real value, so nobody reveals a key or trims a $ to use the
// command. The tokenizer is small on purpose: comments, strings, numbers and keywords for the languages an AI product
// shows, nothing about grammar. JSON view reuses it.

type Language = 'ts' | 'tsx' | 'js' | 'json' | 'bash' | 'python' | 'yaml' | 'text';
type TokenType = 'plain' | 'keyword' | 'string' | 'number' | 'comment' | 'punct' | 'key';
type Token = {type: TokenType; value: string};

const jsKeywords = 'as async await break case catch class const continue default delete do else enum export extends false finally for from function if import in instanceof interface let new null of return static super switch this throw true try type typeof undefined var void while yield';
const config: Record<Language, {line?: string; block?: [string, string]; quotes: string; multi?: string; keywords: Set<string>; word: RegExp}> = {
  ts: {line: '//', block: ['/*', '*/'], quotes: `'"\``, multi: '`', keywords: new Set(jsKeywords.split(' ')), word: /^[A-Za-z_$][\w$]*/},
  tsx: {line: '//', block: ['/*', '*/'], quotes: `'"\``, multi: '`', keywords: new Set(jsKeywords.split(' ')), word: /^[A-Za-z_$][\w$]*/},
  js: {line: '//', block: ['/*', '*/'], quotes: `'"\``, multi: '`', keywords: new Set(jsKeywords.split(' ')), word: /^[A-Za-z_$][\w$]*/},
  json: {quotes: '"', keywords: new Set(['true', 'false', 'null']), word: /^[A-Za-z_]\w*/},
  bash: {line: '#', quotes: `'"`, keywords: new Set('if then else elif fi for while do done case esac in function export local return'.split(' ')), word: /^[A-Za-z_./@~-][\w./@~:=-]*/},
  python: {line: '#', quotes: `'"`, keywords: new Set('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield'.split(' ')), word: /^[A-Za-z_]\w*/},
  yaml: {line: '#', quotes: `'"`, keywords: new Set(['true', 'false', 'null', 'yes', 'no']), word: /^[A-Za-z_][\w.-]*/},
  text: {quotes: '', keywords: new Set(), word: /^\S+/},
};

type State = {block?: boolean; quote?: string};

function tokenizeLine(line: string, lang: Language, state: State): Token[] {
  const c = config[lang];
  const out: Token[] = [];
  const push = (type: TokenType, value: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.value += value; else out.push({type, value});
  };
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    if (state.block && c.block) {
      const end = rest.indexOf(c.block[1]);
      if (end < 0) { push('comment', rest); break; }
      push('comment', rest.slice(0, end + c.block[1].length));
      i += end + c.block[1].length; state.block = false; continue;
    }
    if (state.quote) {
      let j = 0;
      while (j < rest.length && rest[j] !== state.quote) j += rest[j] === '\\' ? 2 : 1;
      if (j >= rest.length) { push('string', rest); break; }
      push('string', rest.slice(0, j + 1)); i += j + 1; state.quote = undefined; continue;
    }
    if (c.line && rest.startsWith(c.line) && (c.line !== '#' || i === 0 || /\s/.test(line[i - 1]))) { push('comment', rest); break; }
    if (c.block && rest.startsWith(c.block[0])) { state.block = true; push('comment', c.block[0]); i += c.block[0].length; continue; }
    const ch = line[i];
    if (c.quotes.includes(ch)) {
      let j = 1;
      while (j < rest.length && rest[j] !== ch) j += rest[j] === '\\' ? 2 : 1;
      if (j >= rest.length && c.multi?.includes(ch)) { state.quote = ch; push('string', rest); break; }
      const value = rest.slice(0, j + 1);
      i += value.length;
      // A JSON or YAML string followed by a colon is a key.
      push((lang === 'json' || lang === 'yaml') && /^\s*:/.test(line.slice(i)) ? 'key' : 'string', value);
      continue;
    }
    if (/\s/.test(ch)) { const m = rest.match(/^\s+/)![0]; push('plain', m); i += m.length; continue; }
    if (lang !== 'text' && /\d/.test(ch) && !/[\w$]/.test(line[i - 1] ?? '')) {
      const m = rest.match(/^\d[\d_.xXa-fA-FeEn]*/)![0]; push('number', m); i += m.length; continue;
    }
    const word = rest.match(c.word);
    if (word) {
      const w = word[0];
      i += w.length;
      if (lang === 'yaml' && /^\s*:/.test(line.slice(i)) && !line.slice(0, i - w.length).trim().replace(/^-\s*/, '')) push('key', w);
      else push(c.keywords.has(w) ? 'keyword' : 'plain', w);
      continue;
    }
    push(lang === 'text' ? 'plain' : 'punct', ch);
    i += 1;
  }
  return out;
}

/** Splits code into lines of tokens. Carries block comments and template strings across lines. */
function tokenize(code: string, language: Language = 'text'): Token[][] {
  const state: State = {};
  return code.split('\n').map(line => tokenizeLine(line, language, state));
}

/** Ink at its steps: never a hue, since colour means status. */
const tokenClass: Record<TokenType, string> = {
  plain: 'text-text-1',
  key: 'text-text-1',
  number: 'text-text-1',
  string: 'text-text-1',
  keyword: 'text-text-1 font-semibold',
  punct: 'text-text-2',
  comment: 'text-text-2',
};

/** A search match inside code: the pressed wash under the text, and the current one in ink. */
const matchClass = 'rounded-tag bg-pressed text-text-1';
const currentMatchClass = 'rounded-tag bg-ink text-text-inverse';

function splitMarks(value: string, start: number, marks: [number, number][], current?: number): ReactNode {
  const end = start + value.length;
  const parts: ReactNode[] = [];
  let at = start;
  marks.forEach(([a, b], m) => {
    if (b <= start || a >= end) return;
    const s = Math.max(a, start), e = Math.min(b, end);
    if (s > at) parts.push(value.slice(at - start, s - start));
    parts.push(<mark key={m} data-current={m === current || undefined} className={m === current ? currentMatchClass : matchClass}>{value.slice(s - start, e - start)}</mark>);
    at = e;
  });
  if (at < end) parts.push(value.slice(at - start));
  return parts;
}

/** Renders one line of tokens. marks wraps search matches, as [start, end) offsets into the line. */
function TokenLine({tokens, marks, current}: {tokens: Token[]; marks?: [number, number][]; current?: number}) {
  if (!tokens.length) return <>{'\n'}</>;
  let offset = 0;
  return <>{tokens.map((token, i) => {
    const start = offset;
    offset += token.value.length;
    return <span key={i} className={tokenClass[token.type]}>{marks?.length ? splitMarks(token.value, start, marks, current) : token.value}</span>;
  })}</>;
}

/** "1,4-6" or [1, 4, 5, 6] to a set of 1-based line numbers. */
function parseLines(lines?: number[] | string): Set<number> {
  if (!lines) return new Set();
  if (Array.isArray(lines)) return new Set(lines);
  const out = new Set<number>();
  for (const part of lines.split(',')) {
    const [a, b] = part.trim().split('-').map(Number);
    if (!a) continue;
    for (let n = a; n <= (b || a); n++) out.add(n);
  }
  return out;
}

const languageLabels: Record<Language, string> = {ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', json: 'JSON', bash: 'Shell', python: 'Python', yaml: 'YAML', text: 'Text'};

// ---------- Copy ----------

type CopyCodeButtonProps = {
  /** What to copy. A function builds a long value only on press. */
  text: string | (() => string);
  /** The button's name: "Copy code", "Copy command". */
  label?: string;
  onCopy?: (text: string) => void;
  className?: string;
};

/**
 * A ghost icon button that copies, then shows a check for 1.6s and says "Copied" once in a status region. If the
 * clipboard refuses, it says "Copy failed" and keeps the copy glyph.
 */
function CopyCodeButton({text, label = 'Copy code', onCopy, className}: CopyCodeButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const value = typeof text === 'function' ? text() : text;
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
      onCopy?.(value);
    } catch {
      setState('failed');
    }
    timer.current = setTimeout(() => setState('idle'), 1600);
  };
  return <>
    <Button data-slot="code-copy" variant="ghost" size="icon-sm" aria-label={label} onClick={copy} className={className}>
      <Icon icon={state === 'copied' ? Check : Copy}/>
    </Button>
    <span role="status" className="sr-only">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : ''}</span>
  </>;
}

// ---------- Secrets ----------

/** A secret as dots, one per hidden character, keeping its first 8 and last 4: sk_demo_••••aaaa. */
function maskSecret(secret: string) {
  if (secret.length <= 12) return '•'.repeat(secret.length);
  return secret.slice(0, 8) + '•'.repeat(secret.length - 12) + secret.slice(-4);
}

function Masked({line, secret, revealed}: {line: string; secret?: string; revealed: boolean}) {
  if (!secret || revealed || !line.includes(secret)) return <TokenLine tokens={tokenize(line, 'bash')[0]}/>;
  const parts = line.split(secret);
  return <>{parts.flatMap((part, i) => {
    const text = <TokenLine key={`t${i}`} tokens={tokenize(part, 'bash')[0]}/>;
    // The dots cannot be selected, and the spoken "hidden secret" is generated content, so a hand selection copies the
    // command around the secret and nothing that looks like a key.
    return i === 0 ? [text] : [<span key={`s${i}`} data-slot="code-block-secret" className="text-text-2 select-none before:sr-only before:content-['hidden_secret']"><span aria-hidden>{maskSecret(secret)}</span></span>, text];
  })}</>;
}

// ---------- Code block ----------

type CodeBlockProps = Omit<React.ComponentProps<'figure'>, 'children' | 'onCopy'> & {
  /** The source, one string. A trailing newline is dropped. In a command block, lines starting with the prompt are commands and the rest is output. */
  code: string;
  /** block: a file or excerpt. command: shell commands with a prompt; copy takes only the commands. */
  variant?: 'block' | 'command';
  /** Sets the tokenizer and the header label when there is no filename. */
  language?: Language;
  /** Shown in the header in mono, in place of the language. */
  filename?: string;
  /** The header row with the filename, wrap and copy. Block only; without it, copy floats at the top end. */
  header?: boolean;
  /** Line numbers in a gutter that copy and selection skip. Block only. */
  lineNumbers?: boolean;
  /** 1-based lines to highlight: [3, 4] or "3-4,9". */
  highlight?: number[] | string;
  /** Start wrapped instead of scrolling sideways. The header toggle switches it. */
  defaultWrap?: boolean;
  /** The first line's number, for an excerpt from a longer file. */
  startLine?: number;
  /** The prompt in a command block. Never selected or copied. */
  prompt?: string;
  /** A substring of a command to show as dots until revealed. Copy always takes the real value. */
  secret?: string;
  /** Past this many lines the body scrolls. */
  maxLines?: number;
  /** The copy button's name. */
  copyLabel?: string;
  /** Called after the copy reaches the clipboard, with what was copied. */
  onCopy?: (text: string) => void;
};

function CodeBlock(props: CodeBlockProps) {
  return props.variant === 'command' ? <CommandBlock {...props}/> : <FileBlock {...props}/>;
}

const scroll = 'overflow-auto focus-visible:focus-ring-inset';
const maxLinesStyle = (maxLines?: number) => (maxLines ? {'--code-max': `calc(${maxLines} * 1lh + var(--space-6))`} as CSSProperties : undefined);

function FileBlock({code, language = 'text', filename, header = true, lineNumbers = false, highlight, defaultWrap = false, startLine = 1, maxLines, copyLabel, onCopy, className, variant: _variant, prompt: _prompt, secret: _secret, ...props}: CodeBlockProps) {
  const [wrap, setWrap] = useState(defaultWrap);
  const source = code.replace(/\n$/, '');
  const lines = tokenize(source, language);
  const marked = parseLines(highlight);
  const digits = String(startLine + lines.length - 1).length;
  const name = filename ?? languageLabels[language];

  return <figure
    data-slot="code-block"
    data-variant="block"
    data-wrap={wrap || undefined}
    className={cn('code-surface relative flex min-w-0 flex-col overflow-hidden rounded-overlay text-text-1 forced-colors:border forced-colors:border-[CanvasText]', className)}
    {...props}
  >
    {header && <figcaption data-slot="code-block-header" className="flex min-h-(--control) items-center gap-2 border-b border-line-faint ps-3 pe-1">
      <span className={cn('min-w-0 flex-1 truncate', filename ? 'type-code-block text-text-1' : 'type-caption text-text-2')}>{name}</span>
      {filename && language !== 'text' && <span className="hidden type-caption text-text-2 sm:block">{languageLabels[language]}</span>}
      <Button data-slot="code-block-wrap" variant="ghost" size="icon-sm" aria-label="Wrap lines" aria-pressed={wrap} onClick={() => setWrap(w => !w)} className="text-text-2 aria-pressed:text-text-1">
        <Icon icon={Wrap} weight={wrap ? 'fill' : 'regular'}/>
      </Button>
      <CopyCodeButton text={source} label={copyLabel} onCopy={onCopy}/>
    </figcaption>}
    <div
      data-slot="code-block-body"
      tabIndex={0}
      role="region"
      aria-label={name}
      dir="ltr"
      className={cn(scroll, 'relative min-h-0 py-3 type-code-block', maxLines && 'max-h-(--code-max)', !header && 'pe-8')}
      style={maxLinesStyle(maxLines)}
    >
      <pre className={wrap ? 'w-full' : 'w-max min-w-full'}>
        <code className="block">
          {lines.map((tokens, i) => {
            const n = startLine + i;
            const on = marked.has(n);
            return <span key={i} data-slot="code-block-line" data-highlighted={on || undefined} className={cn('flex pe-3', !lineNumbers && 'ps-3', on && 'bg-pressed forced-colors:outline forced-colors:outline-1 forced-colors:-outline-offset-1')}>
              {lineNumbers && <span aria-hidden className={cn('sticky start-0 w-(--gutter) shrink-0 ps-3 pe-3 text-end text-text-2 select-none', on ? 'bg-transparent text-text-1' : 'bg-code-surface')} style={{'--gutter': `calc(${digits}ch + var(--space-6))`} as CSSProperties}>{n}</span>}
              {/* "Highlighted" is generated content: read aloud, never selected or copied. */}
              <span className={cn('min-w-0 flex-1', wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre', on && "before:sr-only before:content-['Highlighted:_']")}><TokenLine tokens={tokens}/></span>
            </span>;
          })}
        </code>
      </pre>
    </div>
    {!header && <span className="absolute end-1 top-1.5"><CopyCodeButton text={source} label={copyLabel} onCopy={onCopy}/></span>}
  </figure>;
}

type CommandLine = {kind: 'command' | 'output'; text: string};

/** Splits a command block: lines that start with the prompt are commands; the rest is output. */
function commandLines(code: string, prompt: string): CommandLine[] {
  const lines = code.replace(/\n$/, '').split('\n');
  const marker = prompt ? `${prompt} ` : '';
  const anyPrompt = !!marker && lines.some(l => l.startsWith(marker));
  return lines.map(l => !anyPrompt ? {kind: 'command', text: l} : l.startsWith(marker) ? {kind: 'command', text: l.slice(marker.length)} : {kind: 'output', text: l});
}

function CommandBlock({code, prompt = '$', secret, maxLines, copyLabel = 'Copy command', onCopy, className, variant: _variant, language: _l, filename: _f, header: _h, lineNumbers: _n, highlight: _hl, defaultWrap: _w, startLine: _s, ...props}: CodeBlockProps) {
  const [revealed, setRevealed] = useState(false);
  const lines = commandLines(code, prompt);
  const copyText = lines.filter(l => l.kind === 'command').map(l => l.text).join('\n');
  const many = lines.filter(l => l.kind === 'command').length > 1;
  return <figure
    data-slot="code-block"
    data-variant="command"
    className={cn('code-surface flex min-w-0 items-start gap-1 rounded-overlay py-1 ps-3 pe-1 text-text-1 forced-colors:border forced-colors:border-[CanvasText]', className)}
    {...props}
  >
    <div
      data-slot="code-block-body"
      tabIndex={0}
      role="region"
      aria-label={many ? 'Commands' : 'Command'}
      dir="ltr"
      className={cn(scroll, 'min-w-0 flex-1 py-1 type-code-block', maxLines && 'max-h-(--code-max)')}
      style={maxLinesStyle(maxLines)}
    >
      <pre className="w-max min-w-full">
        {lines.map((line, i) => <div key={i} data-slot={line.kind === 'command' ? 'code-block-command' : 'code-block-output'} className={cn('whitespace-pre', line.kind === 'output' && 'text-text-2')}>
          {line.kind === 'command' && prompt && <span aria-hidden data-slot="code-block-prompt" className="text-text-2 select-none">{prompt} </span>}
          <code>{line.kind === 'command' ? <Masked line={line.text} secret={secret} revealed={revealed}/> : line.text || ' '}</code>
        </div>)}
      </pre>
    </div>
    <span className="flex shrink-0 items-center gap-0.5">
      {secret && <Button data-slot="code-block-reveal" variant="ghost" size="icon-sm" aria-label={revealed ? 'Hide secret' : 'Show secret'} aria-pressed={revealed} onClick={() => setRevealed(r => !r)}>
        <Icon icon={revealed ? Hide : Show}/>
      </Button>}
      <CopyCodeButton text={copyText} label={copyLabel} onCopy={onCopy}/>
    </span>
  </figure>;
}

export {CodeBlock, CopyCodeButton, TokenLine, tokenize, parseLines, commandLines, maskSecret, matchClass, currentMatchClass, languageLabels, type CodeBlockProps, type Language, type Token, type TokenType};
