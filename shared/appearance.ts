export const APPEARANCE_THEMES = [
  { id: 'mist', name: '雾蓝', description: '清透柔和的雾蓝色', shell: '#DCE8F2', sidebar: '#F0F5FA', surface: '#FEFFFF', header: '#F7FAFD', ink: '#263C50', muted: '#5C7185', accent: '#3D6F96', stroke: '#D7E3ED', selection: '#DCEAF6', well: '#F5F9FC', composerEdge: '#B8CDDF', railInk: '#56748E', railActive: '#C6DCEC' },
  { id: 'sage', name: '鼠尾草绿', description: '柔和自然的浅灰绿', shell: '#DCE8E1', sidebar: '#F0F5F2', surface: '#FDFEFD', header: '#F7FAF8', ink: '#2C4136', muted: '#64756B', accent: '#507563', stroke: '#DCE6DF', selection: '#DFECE3', well: '#F6F9F7', composerEdge: '#C4D6CB', railInk: '#597666', railActive: '#C4D9CD' },
  { id: 'wisteria', name: '淡藤紫', description: '含蓄雅致的紫灰色', shell: '#E4E1ED', sidebar: '#F3F1F7', surface: '#FFFFFF', header: '#FAF9FC', ink: '#3D3548', muted: '#756B81', accent: '#76638E', stroke: '#E3DEE9', selection: '#EAE3F3', well: '#FAF8FC', composerEdge: '#D4CADE', railInk: '#736780', railActive: '#D3CBE2' },
  { id: 'sand', name: '暖砂', description: '温润安静的浅砂色', shell: '#E9E2D7', sidebar: '#F7F3ED', surface: '#FFFEFC', header: '#FCFAF6', ink: '#433D32', muted: '#796D5C', accent: '#7B6038', stroke: '#E7DED1', selection: '#EFE4D4', well: '#FAF7F1', composerEdge: '#D7C9B4', railInk: '#82715B', railActive: '#DDCFBA' },
  { id: 'apricot', name: '柔杏', description: '细腻柔和的杏灰色', shell: '#EEE1DC', sidebar: '#FAF3F0', surface: '#FFFDFC', header: '#FDF8F5', ink: '#493B35', muted: '#796860', accent: '#845A44', stroke: '#EBDED7', selection: '#F1E0D6', well: '#FCF6F2', composerEdge: '#DFC8BB', railInk: '#8B7267', railActive: '#E4CDC0' },
  { id: 'graphite', name: '石墨', description: '简洁克制的中性灰', shell: '#E1E4E7', sidebar: '#F2F4F6', surface: '#FFFFFF', header: '#F8F9FA', ink: '#303840', muted: '#63707B', accent: '#566878', stroke: '#DEE3E7', selection: '#E2E8ED', well: '#F6F8FA', composerEdge: '#C9D2DA', railInk: '#687987', railActive: '#CBD5DE' },
] as const

export type AppearanceThemeId = typeof APPEARANCE_THEMES[number]['id']
export type AppearanceMode = 'auto' | 'light' | 'dark'
export const APPEARANCE_MODES = [
  {id:'auto', name:'自动'}, {id:'light', name:'亮色'}, {id:'dark', name:'暗色'},
] as const

export function resolveAppearanceMode(value: unknown): AppearanceMode {
  return value === 'light' || value === 'dark' ? value : 'auto'
}

const DARK_COLORS = {
  mist: {shell:'#182736', sidebar:'#213345', surface:'#2B4053', header:'#263A4C', ink:'#E8F1F9', muted:'#A9C0D4', accent:'#9CC7E9', stroke:'#435F75', selection:'#365774', well:'#26394B', composerEdge:'#5A7F9D', railInk:'#A8C2D8', railActive:'#2E4B64'},
  sage: {shell:'#1C2823', sidebar:'#25342C', surface:'#2E3E34', header:'#29382F', ink:'#E6EEE8', muted:'#AFBFB3', accent:'#ACCEB7', stroke:'#455B4C', selection:'#3B5445', well:'#29382F', composerEdge:'#5D7967', railInk:'#B1C4B7', railActive:'#3A5143'},
  wisteria: {shell:'#252230', sidebar:'#302C3C', surface:'#3A3547', header:'#342F40', ink:'#EEE9F5', muted:'#BDB2CE', accent:'#CAB8E5', stroke:'#574E68', selection:'#514462', well:'#342F40', composerEdge:'#7A6B90', railInk:'#C0B4D0', railActive:'#4B405D'},
  sand: {shell:'#29251F', sidebar:'#342F28', surface:'#403930', header:'#39332B', ink:'#F1EBE1', muted:'#C4B8A7', accent:'#D9C096', stroke:'#5E5343', selection:'#584B37', well:'#383229', composerEdge:'#837157', railInk:'#C9BBA6', railActive:'#514533'},
  apricot: {shell:'#2C2421', sidebar:'#382E29', surface:'#453830', header:'#3D322C', ink:'#F4EAE4', muted:'#CDB9AE', accent:'#DEB49D', stroke:'#655045', selection:'#5E473B', well:'#3C312B', composerEdge:'#8D6E5C', railInk:'#D0B9AC', railActive:'#584136'},
  graphite: {shell:'#202328', sidebar:'#2A2E34', surface:'#343940', header:'#2F333A', ink:'#E9EDF1', muted:'#B3BDC6', accent:'#BDCADA', stroke:'#4C545E', selection:'#475462', well:'#2E3339', composerEdge:'#6B7887', railInk:'#B6C1CC', railActive:'#424F5D'},
} as const

const HOVER_COLORS = {
  mist: {
    light: {hover:'#CCDFF0', hoverInk:'#243D53', hoverBorder:'#7D9EBB', selectedHover:'#BCD3E7'},
    dark: {hover:'#3D607F', hoverInk:'#F0F7FD', hoverBorder:'#769FC0', selectedHover:'#4A7193'},
  },
  sage: {
    light: {hover:'#CFE1D6', hoverInk:'#2C4136', hoverBorder:'#789B88', selectedHover:'#BFD5C7'},
    dark: {hover:'#486352', hoverInk:'#F1F8F3', hoverBorder:'#8AB099', selectedHover:'#547661'},
  },
  wisteria: {
    light: {hover:'#DFD5ED', hoverInk:'#3D3548', hoverBorder:'#9B88B5', selectedHover:'#D0C2E3'},
    dark: {hover:'#635377', hoverInk:'#FAF6FF', hoverBorder:'#AA94C2', selectedHover:'#75618D'},
  },
  sand: {
    light: {hover:'#E7D8C2', hoverInk:'#433D32', hoverBorder:'#A7906B', selectedHover:'#DCC7A8'},
    dark: {hover:'#69583E', hoverInk:'#FFF8ED', hoverBorder:'#BBA17A', selectedHover:'#7B6748'},
  },
  apricot: {
    light: {hover:'#EAD1C2', hoverInk:'#493B35', hoverBorder:'#B38A74', selectedHover:'#DFBEAA'},
    dark: {hover:'#725440', hoverInk:'#FFF6F0', hoverBorder:'#C19B85', selectedHover:'#83614B'},
  },
  graphite: {
    light: {hover:'#D2DDE5', hoverInk:'#303840', hoverBorder:'#8A9BAB', selectedHover:'#C1CFDB'},
    dark: {hover:'#566777', hoverInk:'#F5F8FC', hoverBorder:'#9BAFC3', selectedHover:'#596E80'},
  },
} as const

export function appearancePalette(themeId: unknown, mode: unknown, systemDark: boolean) {
  const theme = resolveAppearanceTheme(themeId)
  const resolvedMode = resolveAppearanceMode(mode)
  const dark = resolvedMode === 'dark' || (resolvedMode === 'auto' && systemDark)
  const colors = {...theme, ...(dark ? DARK_COLORS[theme.id] : {})}
  return {...colors, ...HOVER_COLORS[theme.id][dark ? 'dark' : 'light'], dark,
    onAccent: dark ? colors.shell : '#FFFFFF',
    danger: dark ? '#F2AAA5' : '#AF3946',
    success: dark ? '#A1D4B2' : '#32724E',
    warning: dark ? '#E4C68C' : '#8B6228',
  }
}

/** Old configurations and unrecognized values use the first, default theme. */
export function resolveAppearanceTheme(value: unknown) {
  return APPEARANCE_THEMES.find(theme => theme.id === value) || APPEARANCE_THEMES[0]
}
