export function AssistantIcon({ name }) {
  // Keep the new icon in the JS bundle so an older cached SVG sprite cannot hide it.
  if (name === "magic-edit") return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m12 8 4 4M4 20l4-1L18 9a2.1 2.1 0 0 0-3-3L4 17v3Z"
        fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m6 2 .7 2.3L9 5l-2.3.7L6 8l-.7-2.3L3 5l2.3-.7ZM19 13l.8 2.2L22 16l-2.2.8L19 19l-.8-2.2L16 16l2.2-.8Z"
        fill="currentColor" />
    </svg>
  );
  return (
    <svg aria-hidden="true">
      <use href={`/assets/assistant-icons.svg#${name}`} />
    </svg>
  );
}
