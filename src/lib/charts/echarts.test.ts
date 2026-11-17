import { describe, expect, it } from "vitest";
import { withMotion, type ChartOption } from "./echarts";

const option: ChartOption = { series: [{ type: "bar", data: [1, 2, 3] }] };

describe("withMotion", () => {
  it("turns animation off when the person asks to reduce motion", () => {
    expect(withMotion(option, true).animation).toBe(false);
  });

  it("leaves the chart as it is otherwise, so it keeps ECharts's own default", () => {
    expect(withMotion(option, false)).toBe(option);
    expect(withMotion(option, false).animation).toBeUndefined();
  });

  it("keeps everything else in the option, and does not change the original", () => {
    const reduced = withMotion(option, true);
    expect(reduced.series).toBe(option.series);
    expect(option.animation).toBeUndefined();
  });
});
