import React from 'react';
/** Code-native QUILLIX monogram. No remote image or font request. */
export function QuillixMark({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M7 5h19v20H7V5Z" stroke="currentColor" strokeWidth="3" /><path d="m17 17 11 12M2 12h9M14 1v8" stroke="currentColor" strokeWidth="3" /></svg>;
}
