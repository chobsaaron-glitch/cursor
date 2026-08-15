// TypeScript 6 checks side-effect imports, and Next only ships declarations for
// CSS modules, so a plain global stylesheet import needs one of its own.
declare module '*.css';
