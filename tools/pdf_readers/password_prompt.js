// Asks for a PDF's password. Shared by the tools that open a real statement on the owner's machine.
// A password never comes from the command line or the environment, where it could end up in shell
// history or process listings.

const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
const BACKSPACE_CODES = new Set(["\u007f", "\b"]);
const LINE_ENDS = new Set(["\r", "\n"]);
const INTERRUPTED = 130;
const PROMPT = "PDF password: ";

/**
 * Ask for the PDF's password, hidden when typed at a terminal.
 *
 * Side effects: writes a prompt to stderr, never stdout, and reads stdin.
 *
 * @returns {Promise<string>} The password; empty if stdin has nothing.
 */
export function ask_for_password() {
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
