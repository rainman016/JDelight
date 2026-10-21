import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Home from "./page";

test("首页显示 JDelight 标题", () => {
  render(<Home />);

  expect(
    screen.getByRole("heading", { name: "JDelight", level: 1 }),
  ).toBeInTheDocument();
});
