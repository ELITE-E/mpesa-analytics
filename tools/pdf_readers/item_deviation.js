// Measures how far recorded pdf.js items sit from the generator's modelled items.

/** Largest coordinate deviation allowed before the generator's model counts as wrong. */
export const MAX_DEVIATION_POINTS = 0.5;

const AXES = ["x0", "x1", "top", "bottom"];

/**
 * Compare two statements page by page, pairing each modelled item with its nearest recorded twin.
 *
 * Side effects: none.
 *
 * @param {object} model The generator's statement pages.
 * @param {object} recorded The statement pages from pdf.js.
 * @returns {object} Largest deviation overall and per axis, and counts of unpaired items.
 */
export function measure_deviation(model, recorded) {
  const totals = {
    maximum: 0,
    by_axis: Object.fromEntries(AXES.map((axis) => [axis, 0])),
    unmatched: 0,
    extra: 0,
    extra_whitespace: 0,
    extra_text: 0,
  };
  model.pages.forEach((page, index) => {
    compare_page(page.items, recorded.pages[index]?.items ?? [], totals);
  });
  return totals;
}

/**
 * Compare one page, adding to the running totals.
 *
 * Side effects: updates `totals`.
 *
 * @param {object[]} modelItems The model's items.
 * @param {object[]} recordedItems The recorded items.
 * @param {object} totals Running totals.
 */
function compare_page(modelItems, recordedItems, totals) {
  const remaining = [...recordedItems];
  for (const modelItem of modelItems) {
    const position = nearest_twin(modelItem, remaining);
    if (position === -1) {
      totals.unmatched += 1;
    } else {
      add_deviation(modelItem, remaining.splice(position, 1)[0], totals);
    }
  }
  totals.extra += remaining.length;
  const whitespace = remaining.filter((entry) => entry.text.trim() === "").length;
  totals.extra_whitespace += whitespace;
  totals.extra_text += remaining.length - whitespace;
}

/**
 * Find the unpaired recorded item with the same text that sits closest.
 *
 * Side effects: none.
 *
 * @param {object} modelItem The model's item.
 * @param {object[]} candidates Unpaired recorded items.
 * @returns {number} Position in `candidates`, or -1 if none has this text.
 */
function nearest_twin(modelItem, candidates) {
  let best = -1;
  let bestDistance = Infinity;
  candidates.forEach((candidate, position) => {
    if (candidate.text !== modelItem.text) return;
    const distance =
      Math.abs(candidate.top - modelItem.top) + Math.abs(candidate.x0 - modelItem.x0);
    if (distance < bestDistance) {
      best = position;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * Record how far one pair of items differs.
 *
 * Side effects: updates `totals`.
 *
 * @param {object} modelItem The model's item.
 * @param {object} recordedItem The recorded item.
 * @param {object} totals Running totals.
 */
function add_deviation(modelItem, recordedItem, totals) {
  for (const axis of AXES) {
    const deviation = Math.abs(recordedItem[axis] - modelItem[axis]);
    totals.by_axis[axis] = Math.max(totals.by_axis[axis], deviation);
    totals.maximum = Math.max(totals.maximum, deviation);
  }
}
