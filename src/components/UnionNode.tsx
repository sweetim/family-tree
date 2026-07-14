import { Handle, Position } from "@xyflow/react";

const hidden = "!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";

/** Invisible-handle junction dot where a couple's line meets their children. */
export function UnionNode() {
  return (
    <div className="h-3 w-3 rounded-full border-2 border-slate-400 bg-white">
      <Handle id="l" type="target" position={Position.Left} className={hidden} />
      <Handle id="r" type="target" position={Position.Right} className={hidden} />
      <Handle id="b" type="source" position={Position.Bottom} className={hidden} />
    </div>
  );
}
