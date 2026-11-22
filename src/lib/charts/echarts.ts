/**
 * ECharts, loaded only in the browser and only with the parts these screens use, so the rest of the library does
 * not reach the page. Documented import style: echarts/core with echarts.use, and the Canvas renderer registered
 * explicitly. Apache-2.0, pinned in package.json.
 */
import type { ComposeOption } from "echarts/core";
import type { BarSeriesOption, BoxplotSeriesOption, LineSeriesOption, SankeySeriesOption } from "echarts/charts";
import type {
  AriaComponentOption,
  GridComponentOption,
  LegendComponentOption,
  MarkLineComponentOption,
  TooltipComponentOption,
} from "echarts/components";

export type ChartOption = ComposeOption<
  | BarSeriesOption
  | BoxplotSeriesOption
  | LineSeriesOption
  | SankeySeriesOption
  | AriaComponentOption
  | GridComponentOption
  | LegendComponentOption
  | MarkLineComponentOption
  | TooltipComponentOption
>;

let loaded: Promise<typeof import("echarts/core")> | null = null;

export function loadEcharts(): Promise<typeof import("echarts/core")> {
  if (!loaded) {
    loaded = (async () => {
      const echarts = await import("echarts/core");
      const { BarChart, BoxplotChart, LineChart, SankeyChart } = await import("echarts/charts");
      const { AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TitleComponent, TooltipComponent } = await import(
        "echarts/components"
      );
      const { CanvasRenderer } = await import("echarts/renderers");
      echarts.use([
        BarChart,
        BoxplotChart,
        LineChart,
        SankeyChart,
        AriaComponent,
        GridComponent,
        LegendComponent,
        MarkLineComponent,
        TitleComponent,
        TooltipComponent,
        CanvasRenderer,
      ]);
      return echarts;
    })();
    loaded.catch(() => {
      loaded = null;
    });
  }
  return loaded;
}

/**
 * A person who asks their system to reduce motion gets charts that draw at once, with no bars growing or flows sliding.
 * The charts animate by default, so this only ever turns animation off.
 */
export function withMotion(option: ChartOption, reduceMotion: boolean): ChartOption {
  if (reduceMotion) return { ...option, animation: false };
  // A change of data glides over a third of a second and settles, with no bounce, which would misstate a value.
  return { animationDuration: 600, animationDurationUpdate: 350, animationEasing: "cubicOut", animationEasingUpdate: "cubicOut", ...option };
}
