export function dumpsQuestionPath(id) {
  return `/dumps/${id}/`;
}

export function dumpsQuestionId(pathname) {
  const match = /^\/dumps\/([1-9]\d*)\/$/.exec(pathname);
  return match ? Number(match[1]) : null;
}

export function dumpsQuestionTitle(id) {
  return `문제 ${id} · SAA-C03 문제집`;
}
