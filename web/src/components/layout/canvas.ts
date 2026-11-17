/**
 * The desktop page canvas from the Stitch desktop screens: a 1440px maximum
 * with DESIGN.md's tablet (24px) and desktop (40px) margins. Mobile keeps the
 * 16px padding every story screen already used. Header, footer and content
 * share it so they line up.
 */
export const pageCanvas = "w-full max-w-[1440px] mx-auto px-space-base md:px-6 lg:px-10";

/** The same canvas without the mobile padding, for headers with their own. */
export const canvasFrame = "w-full max-w-[1440px] mx-auto md:px-6 lg:px-10";
