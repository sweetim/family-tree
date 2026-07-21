// Ambient declarations so standalone `tsc --noEmit` (the typecheck script)
// resolves the side-effect CSS imports that Next's compiler handles at build.
declare module "*.css"
