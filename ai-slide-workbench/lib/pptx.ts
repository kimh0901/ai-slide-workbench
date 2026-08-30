import type { DeckSpec, StylePreset, TemplateTheme } from './types';

function hex(value: string) {
  return value.replace('#', '').toUpperCase();
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 70) || 'AI簡報';
}

function applyTemplate(style: StylePreset, theme?: TemplateTheme): StylePreset {
  if (!theme?.colors.length) return style;
  return {
    ...style,
    name: `${theme.name} 樣式`,
    primary: theme.colors[0] ?? style.primary,
    accent: theme.colors[1] ?? style.accent,
    fontFace: theme.fontFace || style.fontFace,
  };
}

export async function exportDeck(deck: DeckSpec, selectedStyle: StylePreset, theme?: TemplateTheme) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  const style = applyTemplate(selectedStyle, theme);
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'AI 簡報工作台';
  pptx.company = '綠能所';
  pptx.subject = '依 AI 培力課程 Rules 產生的可編輯簡報';
  pptx.title = deck.title;
  pptx.theme = {
    headFontFace: style.fontFace,
    bodyFontFace: style.fontFace,
  };

  deck.slides.forEach((item, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: hex(style.background) };
    const isCover = index === 0 || item.visual === 'cover';

    if (isCover) {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: hex(style.primary) }, line: { color: hex(style.primary) } });
      slide.addShape(pptx.ShapeType.rect, { x: 0.65, y: 0.75, w: 0.15, h: 5.85, fill: { color: hex(style.accent) }, line: { color: hex(style.accent) } });
      slide.addText(item.title || deck.title, { x: 1.15, y: 1.62, w: 10.9, h: 1.35, fontFace: style.fontFace, fontSize: 29, bold: true, color: 'FFFFFF', margin: 0, breakLine: false, valign: 'middle' });
      slide.addText(item.conclusion || deck.subtitle, { x: 1.18, y: 3.2, w: 9.8, h: 0.7, fontFace: style.fontFace, fontSize: 16, color: 'DDECE6', margin: 0 });
      slide.addText('AI 簡報工作台｜可編輯 PowerPoint', { x: 1.18, y: 6.35, w: 5, h: 0.3, fontFace: style.fontFace, fontSize: 9.5, color: 'C6DAD2', margin: 0, charSpacing: 1.1 });
    } else {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: hex(style.accent) }, line: { color: hex(style.accent) } });
      slide.addText(item.title, { x: 0.72, y: 0.48, w: 11.55, h: 0.52, fontFace: style.fontFace, fontSize: 22, bold: true, color: hex(style.text), margin: 0, breakLine: false });
      slide.addText(item.conclusion, { x: 0.75, y: 1.23, w: 11.55, h: 0.66, fontFace: style.fontFace, fontSize: 15.5, bold: true, color: hex(style.primary), fill: { color: hex(style.surface), transparency: 2 }, margin: 0.12, valign: 'middle' });

      const bulletRuns = item.bullets.slice(0, 4).map((bullet) => ({
        text: bullet,
        options: { bullet: { indent: 18 }, hanging: 4, breakLine: true },
      }));
      slide.addText(bulletRuns, { x: 0.82, y: 2.15, w: 7.55, h: 3.85, fontFace: style.fontFace, fontSize: 17, color: hex(style.text), margin: 0.08, breakLine: false, paraSpaceAfter: 16, valign: 'top', fit: 'shrink' });

      const numeric = item.bullets.join(' ').match(/(?:\d[\d,.]*\s*(?:%|萬度|kWh|元|場|人次|年|月)?)/)?.[0];
      slide.addShape(pptx.ShapeType.roundRect, { x: 8.78, y: 2.18, w: 3.72, h: 2.38, rectRadius: 0.08, fill: { color: hex(style.primary), transparency: style.id === 'data' ? 0 : 4 }, line: { color: hex(style.primary) } });
      slide.addText(numeric || (item.visual === 'comparison' ? '比較' : '重點'), { x: 9.05, y: 2.64, w: 3.18, h: 0.78, fontFace: style.fontFace, fontSize: numeric ? 28 : 24, bold: true, color: 'FFFFFF', margin: 0, align: 'center', valign: 'middle', fit: 'shrink' });
      slide.addText(item.visual === 'comparison' ? '決策對照' : item.visual === 'data' ? '關鍵數據' : '本頁核心', { x: 9.18, y: 3.56, w: 2.9, h: 0.34, fontFace: style.fontFace, fontSize: 10.5, color: 'E5F1ED', margin: 0, align: 'center', charSpacing: 1.2 });

      slide.addText(item.source || '來源：使用者提供素材', { x: 0.76, y: 6.76, w: 10.7, h: 0.25, fontFace: style.fontFace, fontSize: 8.5, color: hex(style.muted), margin: 0, fit: 'shrink' });
      slide.addText(String(index + 1).padStart(2, '0'), { x: 12.15, y: 6.72, w: 0.48, h: 0.28, fontFace: style.fontFace, fontSize: 9, bold: true, color: hex(style.muted), margin: 0, align: 'right' });
    }
    if (item.speakerNotes) slide.addNotes(item.speakerNotes);
  });

  await pptx.writeFile({ fileName: `${safeFileName(deck.title)}.pptx` });
}
