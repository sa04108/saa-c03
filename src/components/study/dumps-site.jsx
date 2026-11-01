"use client";
import { useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { DumpsPage } from "./dumps-page";
import { dumpsQuestionId, dumpsQuestionPath, dumpsQuestionTitle } from "@/lib/study/paths";

function openQuestion(id, { replace = false } = {}) {
  const path = dumpsQuestionPath(id);
  if (location.pathname === path && (!location.hash || !replace)) return;
  // The question bank is already loaded. Next.js synchronizes usePathname
  // with native history without reloading the study session for each question.
  history[replace ? "replaceState" : "pushState"](null, "", path);
}

export function DumpsSite() {
  const pathname = usePathname();
  const route = useMemo(() => ({
    questionId: dumpsQuestionId(pathname),
    open: openQuestion,
  }), [pathname]);
  useEffect(() => {
    document.title = route.questionId
      ? dumpsQuestionTitle(route.questionId)
      : "SAA-C03 문제집";
  }, [route.questionId]);
  return <DumpsPage route={route} />;
}
