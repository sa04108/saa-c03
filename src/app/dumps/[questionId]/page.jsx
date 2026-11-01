import { notFound } from "next/navigation";
import bank from "@/data/questions.json";
import { dumpsQuestionTitle } from "@/lib/study/paths";

const questions = new Map(bank.questions.map((question) => [String(question.id), question]));
export const dynamicParams = false;

export function generateStaticParams() {
  return bank.questions.map(({ id }) => ({ questionId: String(id) }));
}

export async function generateMetadata({ params }) {
  const question = questions.get((await params).questionId);
  return question ? {
    title: dumpsQuestionTitle(question.id),
    description: question.stem.replace(/\[\[img\d+\]\]/g, "").replace(/\s+/g, " ").trim().slice(0, 160),
  } : {};
}

export default async function Page({ params }) {
  if (!questions.has((await params).questionId)) notFound();
  return null;
}
