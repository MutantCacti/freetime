// How ft prints (DEV-SPEC.md §2.1). The words themselves live in messages.mjs;
// this module only lays them out, colours them and redacts secrets.

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** @param {string} s */
export const stripAnsi = (s) => s.replace(ANSI, "");

/** Replaces every known secret value with `[NAME]` before anything is printed. */
export function createRedactor() {
  /** @type {Map<string, string>} */
  const values = new Map();
  return {
    /** @param {string} name @param {string | undefined} value */
    add(name, value) {
      if (!value) return;
      const parts = [value, ...value.split(/[\s,]+/)];
      for (const v of parts) if (v.length >= 6 && !values.has(v)) values.set(v, name);
    },
    /** @param {string} s */
    apply(s) {
      const sorted = [...values.entries()].sort((a, b) => b[0].length - a[0].length);
      for (const [v, n] of sorted) s = s.split(v).join(`[${n}]`);
      return s;
    },
  };
}

/** @typedef {"ok" | "warn" | "fail" | "skip" | "info"} Kind */

const WORDS = {
  // PRINTED OUTPUT: ft / check status words
  ok: ["ok", "32"],
  // PRINTED OUTPUT: ft / check status words
  warn: ["warn", "33"],
  // PRINTED OUTPUT: ft / check status words
  fail: ["FAIL", "31"],
  // PRINTED OUTPUT: ft / check status words
  skip: ["skip", "2"],
  // PRINTED OUTPUT: ft / check status words
  info: ["--", "2"],
};

export const NAME_WIDTH = 18;
export const PREFIX_WIDTH = 9;

/**
 * @param {{ write: (s: string) => void, color: boolean }} o
 */
export function createOutput({ write, color }) {
  const redactor = createRedactor();
  /** @param {string} code @param {string} s */
  const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  /** @param {string} s */
  const emit = (s) => write(redactor.apply(s));
  const indent = " ".repeat(2 + 6 + NAME_WIDTH);

  return {
    redactor,
    color,
    /** One line of plain text. @param {string} [s] */
    text(s = "") {
      emit(`${s}\n`);
    },
    /** Several lines. @param {string} block */
    block(block) {
      emit(block.endsWith("\n") ? block : `${block}\n`);
    },
    /** A heading line. @param {string} s */
    heading(s) {
      emit(`\n${color ? `\x1b[1m${s}\x1b[0m` : s}\n`);
    },
    /**
     * One check: status word, name, message, then any further lines indented under the message.
     * @param {Kind} kind @param {string} name @param {string} message @param {string[]} [more]
     */
    check(kind, name, message, more = []) {
      const [word, code] = WORDS[kind];
      emit(`  ${paint(code, word.padEnd(6))}${name.padEnd(NAME_WIDTH)}${message}\n`);
      for (const m of more) emit(`${indent}${m}\n`);
    },
    /** A line from wrangler, npm or a Worker, under its source's name. @param {string} source @param {string} line */
    prefixed(source, line) {
      emit(`${paint("2", source.padEnd(PREFIX_WIDTH))}| ${line}\n`);
    },
    /** @param {string} s */
    bold(s) {
      return color ? `\x1b[1m${s}\x1b[0m` : s;
    },
  };
}

/** @typedef {ReturnType<typeof createOutput>} Output */

/**
 * The same output, silent while `quiet()` is true: what a step a signal cut short would
 * report (a killed `wrangler whoami` reads as "not logged in") isn't news, so it isn't printed.
 * @param {Output} out @param {() => boolean} quiet @returns {Output}
 */
export function mutedWhen(out, quiet) {
  /** @template {(...a: any[]) => any} F @param {F} f @returns {F} */
  const gate = (f) => /** @type {F} */ ((...a) => (quiet() ? undefined : f(...a)));
  return { ...out, text: gate(out.text), block: gate(out.block), heading: gate(out.heading), check: gate(out.check), prefixed: gate(out.prefixed) };
}
