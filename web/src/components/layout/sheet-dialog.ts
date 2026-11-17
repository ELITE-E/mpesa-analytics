/**
 * Native <dialog> presented as a bottom sheet on mobile and tablet, and as a
 * centred modal from 1024px. Stitch designs no desktop dialog; this is the
 * smallest adaptation of the existing sheet.
 */
export const sheetDialogClasses =
  "fixed inset-x-0 bottom-0 top-auto m-0 mx-auto w-full max-w-lg max-h-[85dvh] rounded-t-2xl bg-surface-container-lowest text-on-surface p-space-lg shadow-2xl backdrop:bg-inverse-surface/60 backdrop:backdrop-blur-sm lg:inset-0 lg:m-auto lg:h-fit lg:rounded-2xl";
