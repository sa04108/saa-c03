export function AssistantIcon({ name }) {
  return (
    <svg aria-hidden="true">
      <use href={`/assets/assistant-icons.svg#${name}`} />
    </svg>
  );
}
