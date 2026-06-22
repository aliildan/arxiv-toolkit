// Type declaration for turndown-plugin-gfm (CJS package; no official @types entry).
// The default export is the namespace object; `gfm` is a plugin function property.
declare module "turndown-plugin-gfm" {
  import TurndownService from "turndown";
  type TurndownPlugin = (service: TurndownService) => void;
  const gfm: TurndownPlugin;
  const strikethrough: TurndownPlugin;
  const tables: TurndownPlugin;
  const taskListItems: TurndownPlugin;
  interface GfmNamespace {
    gfm: TurndownPlugin;
    strikethrough: TurndownPlugin;
    tables: TurndownPlugin;
    taskListItems: TurndownPlugin;
  }
  const ns: GfmNamespace;
  export = ns;
}
