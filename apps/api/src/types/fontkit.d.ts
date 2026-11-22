/** fontkit ships no types; documents/fonts.ts uses only openSync. */
declare module 'fontkit' {
  export function openSync(path: string, postscriptName?: string): unknown;
}
