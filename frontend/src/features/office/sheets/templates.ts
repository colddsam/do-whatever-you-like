/** Starter workbooks for the spreadsheet editor. */
import { blankSheet, blankWorkbook, DEFAULT_ROW_H, key, newId, type CellStyle, type Workbook } from "./model";

type Row = (string | number | null | [string | number, CellStyle])[];

function sheetFrom(name: string, rows: Row[], opts: { widths?: number[]; freeze?: number; header?: CellStyle } = {}): Workbook {
  const wb = blankWorkbook();
  const sh = { ...blankSheet(name), id: newId() };
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell === null) return;
      if (Array.isArray(cell)) sh.cells[key(r, c)] = { v: cell[0], s: cell[1] };
      else sh.cells[key(r, c)] = { v: cell, s: r === 0 && opts.header ? opts.header : undefined };
    }),
  );
  opts.widths?.forEach((w, i) => (sh.colW[i] = w));
  // Rows holding a large font get a taller row, as Excel does, so titles aren't clipped.
  for (const [k, cell] of Object.entries(sh.cells)) {
    const size = cell.s?.size ?? 11;
    if (size <= 11) continue;
    const r = Number(k.split(",")[0]);
    sh.rowH[r] = Math.max(sh.rowH[r] ?? DEFAULT_ROW_H, Math.ceil((size * 96) / 72 * 1.3 + 6));
  }
  if (opts.freeze) sh.freeze = { r: opts.freeze, c: 0 };
  wb.sheets = [sh];
  return wb;
}

const H: CellStyle = { bold: true, fill: "#1a7f4b", color: "#ffffff", align: "center" };
const money = (v: number | string): [number | string, CellStyle] => [v, { fmt: '"$"#,##0.00' }];
const bold = (v: string | number): [string | number, CellStyle] => [v, { bold: true }];
const styled = (v: string | number, s: CellStyle): [string | number, CellStyle] => [v, s];

export const SHEET_TEMPLATES: { id: string; name: string; description: string; build: () => Workbook }[] = [
  { id: "blank", name: "Blank workbook", description: "An empty sheet", build: blankWorkbook },
  {
    id: "budget",
    name: "Monthly budget",
    description: "Income, expenses and what's left, with a chart",
    build: () => {
      const wb = sheetFrom(
        "Budget",
        [
          ["Category", "Planned", "Actual", "Difference"],
          ["Salary", money(4000), money(4100), ["=C2-B2", { fmt: '"$"#,##0.00;[Red]-"$"#,##0.00' }]],
          ["Rent", money(-1400), money(-1400), ["=C3-B3", { fmt: '"$"#,##0.00;[Red]-"$"#,##0.00' }]],
          ["Groceries", money(-450), money(-520), ["=C4-B4", { fmt: '"$"#,##0.00;[Red]-"$"#,##0.00' }]],
          ["Transport", money(-150), money(-120), ["=C5-B5", { fmt: '"$"#,##0.00;[Red]-"$"#,##0.00' }]],
          ["Utilities", money(-200), money(-185), ["=C6-B6", { fmt: '"$"#,##0.00;[Red]-"$"#,##0.00' }]],
          ["Fun", money(-250), money(-310), ["=C7-B7", { fmt: '"$"#,##0.00;[Red]-"$"#,##0.00' }]],
          ["Savings", money(-800), money(-800), ["=C8-B8", { fmt: '"$"#,##0.00;[Red]-"$"#,##0.00' }]],
          [bold("Total"), ["=SUM(B2:B8)", { bold: true, fmt: '"$"#,##0.00', bt: { style: "thin", color: "#000000" } }], ["=SUM(C2:C8)", { bold: true, fmt: '"$"#,##0.00', bt: { style: "thin", color: "#000000" } }], ["=SUM(D2:D8)", { bold: true, fmt: '"$"#,##0.00;[Red]-"$"#,##0.00', bt: { style: "thin", color: "#000000" } }]],
        ],
        { widths: [160, 110, 110, 110], freeze: 1, header: H },
      );
      wb.sheets[0].charts.push({ id: newId("ch"), type: "column", range: "A1:C8", title: "Planned vs actual", x: 470, y: 10, w: 460, h: 280, headers: true, legend: true });
      return wb;
    },
  },
  {
    id: "invoice",
    name: "Invoice",
    description: "Items, tax and total due",
    build: () =>
      sheetFrom(
        "Invoice",
        [
          [styled("INVOICE", { bold: true, size: 20, color: "#1a7f4b" }), null, null, styled("=TODAY()", { fmt: "d mmm yyyy", align: "right" })],
          ["Bill to:", "Client name"],
          [null],
          ["Item", "Qty", "Unit price", "Amount"],
          ["Design work", 10, money(50), ["=B5*C5", { fmt: '"$"#,##0.00' }]],
          ["Development", 20, money(65), ["=B6*C6", { fmt: '"$"#,##0.00' }]],
          ["Hosting (1 year)", 1, money(120), ["=B7*C7", { fmt: '"$"#,##0.00' }]],
          [null, null, bold("Subtotal"), ["=SUM(D5:D7)", { fmt: '"$"#,##0.00' }]],
          [null, null, "Tax rate", [0.08, { fmt: "0%" }]],
          [null, null, "Tax", ["=D8*D9", { fmt: '"$"#,##0.00' }]],
          [null, null, bold("Total due"), ["=D8+D10", { bold: true, fmt: '"$"#,##0.00', fill: "#d8ebdf" }]],
        ].map((r, i): Row => (i === 3 ? r.map((c) => styled(c as string, H)) : (r as Row))),
        { widths: [200, 70, 110, 120] },
      ),
  },
  {
    id: "todo",
    name: "To-do list",
    description: "Tasks with status drop-downs and highlights",
    build: () => {
      const wb = sheetFrom(
        "Tasks",
        [
          ["Task", "Owner", "Due", "Status", "Priority"],
          ["Plan the launch", "Asha", [46050, { fmt: "d mmm yyyy" }], "In progress", "High"],
          ["Write the copy", "Ben", [46055, { fmt: "d mmm yyyy" }], "Not started", "Medium"],
          ["Design the banner", "Chen", [46048, { fmt: "d mmm yyyy" }], "Done", "Low"],
          ["Ship it", "Asha", [46060, { fmt: "d mmm yyyy" }], "Not started", "High"],
        ],
        { widths: [220, 100, 110, 120, 90], freeze: 1, header: H },
      );
      const sh = wb.sheets[0];
      sh.validations.push({ id: newId("dv"), range: "D2:D100", type: "list", list: ["Not started", "In progress", "Done", "Blocked"] });
      sh.validations.push({ id: newId("dv"), range: "E2:E100", type: "list", list: ["High", "Medium", "Low"] });
      sh.cond.push({ id: newId("cf"), range: "D2:D100", type: "eq", a: "Done", style: { fill: "#c6efce", color: "#006100" } });
      sh.cond.push({ id: newId("cf"), range: "E2:E100", type: "eq", a: "High", style: { fill: "#ffc7ce", color: "#9c0006" } });
      return wb;
    },
  },
  {
    id: "grades",
    name: "Grade book",
    description: "Scores, averages and letter grades",
    build: () =>
      sheetFrom(
        "Grades",
        [
          ["Student", "Test 1", "Test 2", "Project", "Average", "Grade"],
          ...[
            ["Aarav", 88, 92, 95],
            ["Bella", 72, 65, 80],
            ["Carlos", 95, 98, 91],
            ["Diya", 58, 70, 66],
            ["Ethan", 81, 77, 89],
          ].map((r, i) => [...r, [`=AVERAGE(B${i + 2}:D${i + 2})`, { fmt: "0.0" }], `=IFS(E${i + 2}>=90,"A",E${i + 2}>=80,"B",E${i + 2}>=70,"C",E${i + 2}>=60,"D",TRUE,"F")`] as Row),
          [bold("Class average"), "=AVERAGE(B2:B6)", "=AVERAGE(C2:C6)", "=AVERAGE(D2:D6)", ["=AVERAGE(E2:E6)", { fmt: "0.0", bold: true }]],
        ],
        { widths: [140, 80, 80, 80, 90, 70], freeze: 1, header: H },
      ),
  },
];
