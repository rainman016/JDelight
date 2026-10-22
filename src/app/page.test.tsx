import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { SourcePaper } from "../components/source-paper";
import { sourceLines } from "../domain/source";
test("校对纸展示准确行号、保留空行并标出警示行", () => {
  const { container } = render(
    <SourcePaper lines={sourceLines("岗位职责\n\n负责产品，")} flagged={[3]} />,
  );
  expect(screen.getByText("原文 · 3 行")).toBeVisible();
  expect(container.querySelector('[data-flag="true"]')).toHaveTextContent(
    "负责产品，",
  );
  expect(container.querySelectorAll(".pl")).toHaveLength(3);
});
