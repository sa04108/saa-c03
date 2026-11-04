export const BANK_ID = "saa-c03-618-20261104-v2";
export const QUESTION_COUNT = 618;

export function isAvailableQuestion(id) {
  return Number.isInteger(id) && id >= 1 && id <= QUESTION_COUNT;
}
