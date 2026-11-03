#!/usr/bin/env node
// Profiles a PDF through the real pdf.js adapter. Prints counts and a duration, never its text or
// its path. If the PDF needs a password, it asks with a hidden prompt; it never takes one from
// the command line or the environment.
//   node tools/engines/profile_pdfjs.mjs <path>
import { readFileSync } from "node:fs";

import { ExtractionError, extract_statement_pages } from "../../engine/pdfjs/adapter.js";
import { use_node_engine } from "./fixture_engine.js";

const CANNOT_READ = 2;
const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
const BACKSPACE_CODES = new Set(["\u007f", "\b"]);
const LINE_ENDS = new Set(["\r", "\n"]);
const INTERRUPTED = 130;
const NO_LIMIT = Number.MAX_SAFE_INTEGER;
const PROMPT = "PDF password: ";
const MS_PER_SECOND = 1000;
const SAME_LINE_POINTS = 1;
const SHARE_DIGITS = 3;
const DATE_AND_TIME = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY = /^\d{2}:\d{2}:\d{2}$/;
const RECEIPT = /^(?=[A-Z0-9]*\d)[A-Z0-9]{8,14}$/;
// A profile measures a whole statement, so the app's limits do not apply here.
const PROFILE_LIMITS = { byteLimit: NO_LIMIT, pageLimit: NO_LIMIT, timeoutMs: 2 ** 31 - 1 };

process.exit(await main());

/**
 * Profile the PDF named on the command line.
 *
 * Side effects: reads the PDF, may prompt, and writes counts to stdout.
 *
 * @returns {Promise<number>} Process exit code: 0 on success, 2 if the PDF cannot be read.
 */
async function main() {
  const paths = process.argv.slice(2);
  if (paths.length !== 1 || paths[0].startsWith("-")) {
    console.log("profile_pdfjs: ERROR (expected exactly one PDF path and nothing else)");
    return CANNOT_READ;
  }
  // pdf.js warns on load and can quote the file; nothing but counts may leave this tool.
  console.warn = () => undefined;
  await use_node_engine();
  try {
    const { statementPages, elapsedSeconds } = await extract_with_prompt(readFileSync(paths[0]));
    print_profile(statementPages, elapsedSeconds);
    return 0;
  } catch (error) {
    // Only a code: other messages could quote the file or its path.
    const reason = error instanceof ExtractionError ? error.code : "CANNOT_READ";
    console.log(`profile_pdfjs: ERROR (${reason})`);
    return CANNOT_READ;
  }
}

/**
 * Extract the statement, asking for a password only if the PDF needs one.
 *
 * Side effects: runs pdf.js, and may prompt and read a password.
 *
 * @param {Uint8Array} fileBytes The PDF's bytes.
 * @returns {Promise<{statementPages: object, elapsedSeconds: number}>} The result and its timing.
 */
async function extract_with_prompt(fileBytes) {
  const bytes = new Uint8Array(fileBytes);
  try {
    return await timed_extraction(bytes, undefined);
  } catch (error) {
    if (error.code !== "PASSWORD_REQUIRED") throw error;
  }
  return timed_extraction(bytes, await ask_for_password());
}

/**
 * Run one extraction and time it, so typing a password does not count.
 *
 * Side effects: runs pdf.js.
 *
 * @param {Uint8Array} bytes The PDF's bytes.
 * @param {string} [password] The password, if there is one.
 * @returns {Promise<{statementPages: object, elapsedSeconds: number}>} The result and its timing.
 */
async function timed_extraction(bytes, password) {
  const started = performance.now();
  const statementPages = await extract_statement_pages(bytes, password, PROFILE_LIMITS);
  return { statementPages, elapsedSeconds: (performance.now() - started) / MS_PER_SECOND };
}

/**
 * Ask for the PDF's password, hidden when typed at a terminal.
 *
 * Side effects: writes a prompt to stderr, never stdout, and reads stdin.
 *
 * @returns {Promise<string>} The password; empty if stdin has nothing.
 */
function ask_for_password() {
  return process.stdin.isTTY ? read_hidden_line() : read_piped_line();
}

/**
 * Read one line from the terminal with echo off.
 *
 * Side effects: puts the terminal in raw mode until the line ends, writes the prompt to stderr,
 * and reads stdin. Ctrl-C exits the process.
 *
 * @returns {Promise<string>} The line typed.
 */
function read_hidden_line() {
  return new Promise((resolve) => {
    let typed = "";
    // Echo goes off before the prompt shows, or fast typing would appear on screen.
    process.stdin.setRawMode(true);
    process.stderr.write(PROMPT);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.on("data", (chunk) => {
      for (const character of chunk) {
        if (character === CTRL_C) process.exit(INTERRUPTED);
        if (LINE_ENDS.has(character) || character === CTRL_D) {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stderr.write("\n");
          resolve(typed);
          return;
        }
        typed = BACKSPACE_CODES.has(character) ? typed.slice(0, -1) : typed + character;
      }
    });
  });
}

/**
 * Read one line from piped stdin.
 *
 * Side effects: writes the prompt to stderr and reads stdin to its end.
 *
 * @returns {Promise<string>} The first line, without its ending.
 */
async function read_piped_line() {
  process.stderr.write(PROMPT);
  let piped = "";
  for await (const chunk of process.stdin) piped += chunk;
  return piped.split(/\r?\n/, 1)[0];
}

/**
 * Print the profile: fixed labels and numbers only.
 *
 * Side effects: writes to stdout.
 *
 * @param {object} statementPages The statement pages.
 * @param {number} elapsedSeconds How long extraction took.
 */
function print_profile(statementPages, elapsedSeconds) {
  const items = statementPages.pages.flatMap((page) => page.items);
  const whitespace = items.filter((entry) => entry.text.trim() === "").length;
  const anchors = count_anchor_lines(statementPages.pages);
  const profile = {
    page_count: statementPages.pages.length,
    item_count: items.length,
    elapsed_seconds: elapsedSeconds.toFixed(SHARE_DIGITS),
    whitespace_only_items: whitespace,
    whitespace_only_share: share_of(whitespace, items.length),
    anchor_lines: anchors.total,
    date_time_one_item_share: share_of(anchors.oneItem, anchors.total),
    date_time_two_items_share: share_of(anchors.twoItems, anchors.total),
  };
  for (const [label, value] of Object.entries(profile)) console.log(`${label}: ${value}`);
}

/**
 * Count lines holding a receipt number and a date, by how the date and time are printed.
 *
 * Side effects: none.
 *
 * @param {object[]} pages The statement's pages.
 * @returns {{total: number, oneItem: number, twoItems: number}} The counts.
 */
function count_anchor_lines(pages) {
  const counts = { total: 0, oneItem: 0, twoItems: 0 };
  for (const page of pages) {
    for (const line of group_into_lines(page.items)) {
      if (!line.some((text) => RECEIPT.test(text))) continue;
      const oneItem = line.some((text) => DATE_AND_TIME.test(text));
      const twoItems =
        line.some((text) => DATE_ONLY.test(text)) && line.some((text) => TIME_ONLY.test(text));
      counts.total += oneItem || twoItems ? 1 : 0;
      counts.oneItem += oneItem ? 1 : 0;
      counts.twoItems += twoItems ? 1 : 0;
    }
  }
  return counts;
}

/**
 * Group a page's text items into lines by vertical position.
 *
 * Side effects: none.
 *
 * @param {object[]} items The page's text items.
 * @returns {string[][]} The text of each line.
 */
function group_into_lines(items) {
  const lines = [];
  const ordered = [...items].sort((upper, lower) => upper.top - lower.top);
  let lineTop = null;
  for (const entry of ordered) {
    if (lineTop === null || entry.top - lineTop > SAME_LINE_POINTS) {
      lines.push([]);
      lineTop = entry.top;
    }
    lines.at(-1).push(entry.text);
  }
  return lines;
}

/**
 * Work out a share.
 *
 * Side effects: none.
 *
 * @param {number} part The part.
 * @param {number} whole The whole.
 * @returns {number} The share to three places, or 0 for an empty whole.
 */
function share_of(part, whole) {
  return whole ? Number((part / whole).toFixed(SHARE_DIGITS)) : 0;
}
