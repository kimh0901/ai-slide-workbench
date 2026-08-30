import type { StylePreset } from './types';

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'energy',
    name: '綠能專業',
    description: '穩健、可信，適合能源成果與政策說明',
    background: 'F4F8F6', surface: 'FFFFFF', primary: '126149', accent: 'EAA13B', text: '183129', muted: '64736E', fontFace: 'Microsoft JhengHei',
  },
  {
    id: 'consulting',
    name: '顧問清晰',
    description: '結論先行，適合主管決策與比較分析',
    background: 'F4F7FB', surface: 'FFFFFF', primary: '235789', accent: '46A5A5', text: '152B46', muted: '65758A', fontFace: 'Microsoft JhengHei',
  },
  {
    id: 'policy',
    name: '政策穩重',
    description: '正式沉穩，適合對外簡報與公部門場合',
    background: 'F7F5F0', surface: 'FFFFFF', primary: '20354A', accent: 'B68A4A', text: '202A33', muted: '6B7379', fontFace: 'Microsoft JhengHei',
  },
  {
    id: 'data',
    name: '數據亮點',
    description: '高對比與醒目數字，適合月報與績效報告',
    background: '101C22', surface: '172830', primary: '7CE0B7', accent: 'FFB357', text: 'F4FAF7', muted: 'B4C7C0', fontFace: 'Microsoft JhengHei',
  },
  {
    id: 'minimal',
    name: '極簡留白',
    description: '俐落、安靜，適合提案與課程教材',
    background: 'FBFBFA', surface: 'FFFFFF', primary: '171717', accent: 'E35D3F', text: '181818', muted: '737373', fontFace: 'Microsoft JhengHei',
  },
];
