import { describe, expect, it } from "vitest";
import { withMotion, type ChartOption } from "./echarts";

const option: ChartOption = { series: [{ type: "bar", data: [1, 2, 3] }] };

describe("withMotion", () => {
  it("turns animation off when the person asks to reduce motion", () => {
    expect(withMotion(option, true).animation).toBe(false);
  });

  it("adds a short glide with no bounce when motion is allowed, and never turns animation off", () => {
    const moving = withMotion(option, false);
    expect(moving.animation).toBeUndefined();
    expect(moving.animationDurationUpdate).toBe(350);
    expect(moving.animationEasingUpdate).toBe("cubicOut");
    expect(String(moving.animationEasing)).not.toMatch(/bounce|elastic|back/i);
    expect(String(moving.animationEasingUpdate)).not.toMatch(/bounce|elastic|back/i);
    expect(moving.series).toBe(option.series);
  });

  it("lets a chart's own timing win over the defaults", () => {
    expect(withMotion({ ...option, animationDurationUpdate: 100 }, false).animationDurationUpdate).toBe(100);
  });

  it("keeps everything else in the option, and does not change the original", () => {
    const reduced = withMotion(option, true);
    expect(reduced.series).toBe(option.series);
    expect(option.animation).toBeUndefined();
  });
});
