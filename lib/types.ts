export type FlowMode = 'source' | 'template';

export type TemplateTheme = {
  name: string;
  colors: string[];
  fontFace?: string;
  slideCount: number;
};

export type ParsedSource = {
  id: string;
  name: string;
  extension: string;
  text: string;
  characters: number;
  units: number;
  unitLabel: string;
  isTemplate?: boolean;
  theme?: TemplateTheme;
};

export type Requirements = {
  topic: string;
  scenario: string;
  audience: string;
  objective: string;
  slideCount: number;
  duration: number;
  tone: string;
  structure: string;
  notes: boolean;
  classification: '公開' | '內部' | '機密';
};

export type DeckSlide = {
  id: string;
  title: string;
  conclusion: string;
  bullets: string[];
  visual: 'cover' | 'content' | 'data' | 'comparison' | 'section' | 'conclusion';
  source: string;
  speakerNotes: string;
};

export type DeckSpec = {
  title: string;
  subtitle: string;
  generatedBy: string;
  slides: DeckSlide[];
  warnings: string[];
};

export type StylePreset = {
  id: string;
  name: string;
  description: string;
  background: string;
  surface: string;
  primary: string;
  accent: string;
  text: string;
  muted: string;
  fontFace: string;
};
