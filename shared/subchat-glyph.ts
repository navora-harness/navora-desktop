/** Local, deterministic identity artwork. Changing the version deliberately changes the seed. */
export const SUBCHAT_GLYPH_VERSION = 'v3'
export const SUBCHAT_GLYPH_STYLES = [
  {id:'mixed',name:'混合生成',description:'按种子选择图案，再生成形态与配色'},
  {id:'origami',name:'折纸晶体',description:'切角、折面与层叠轮廓'},
  {id:'sigil',name:'几何符印',description:'圆弧、留白与几何组合'},
  {id:'sprout',name:'叶芽生长',description:'分枝、叶形与自然曲线'},
  {id:'orbit',name:'星体轨道',description:'星体、光环与卫星轨迹'},
  {id:'kaleidoscope',name:'万花筒',description:'多层花瓣、对称与丰富配色'},
] as const
export type SubchatGlyphStyle=typeof SUBCHAT_GLYPH_STYLES[number]['id']
export function resolveSubchatGlyphStyle(value:unknown,strict=false):SubchatGlyphStyle{
  if(value===undefined)return 'mixed'
  if(SUBCHAT_GLYPH_STYLES.some(item=>item.id===value))return value as SubchatGlyphStyle
  if(strict)throw Error('invalid_config: app.subchat_glyph_style must be a supported identity style')
  return 'mixed'
}

function seededRandom(id: string,style:SubchatGlyphStyle='kaleidoscope'): () => number {
  let state = 2166136261
  const input = `${SUBCHAT_GLYPH_VERSION}:${style}:${id}`
  for (let i = 0; i < input.length; i++) state = Math.imul(state ^ input.charCodeAt(i), 16777619) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const number = (value: number): string => String(Math.round(value * 100) / 100)
const point = (x: number, y: number): string => `${number(x)} ${number(y)}`
const color = (hue: number, saturation: number, lightness: number): string =>
  `hsl(${number((hue % 360 + 360) % 360)} ${number(saturation)}% ${number(lightness)}%)`

type Petal = {profile: number; radius: number; base: number; width: number; bend: number; shoulder: number; tip: number}

/** Each profile is a continuously variable shape, rather than a pre-drawn icon. */
function petalPath({profile, radius: r, base: b, width: w, bend: k, shoulder: s, tip: t}: Petal): string {
  const middle = b + (r - b) * s
  if (profile === 0) return `M${point(0, -b)}C${point(-w, -b)} ${point(-w + k, -middle)} ${point(-w * t + k, -r * .94)}Q${point(k, -r - .2)} ${point(w * t + k, -r * .94)}C${point(w + k, -middle)} ${point(w, -b)} ${point(0, -b)}Z`
  if (profile === 1) return `M${point(0, -b)}Q${point(-w + k, -middle)} ${point(k, -r)}Q${point(w + k, -middle)} ${point(0, -b)}Z`
  if (profile === 2) return `M${point(0, -b)}L${point(-w * .7, -middle)} ${point(k - w * t, -r * .86)} ${point(k, -r)} ${point(k + w * t, -r * .86)} ${point(w, -middle)}Z`
  if (profile === 3) return `M${point(-w * .18, -b)}L${point(-w + k, -r * .85)}Q${point(k, -r - .2)} ${point(w + k, -r * .85)}L${point(w * .18, -b)}Q${point(0, -middle)} ${point(-w * .18, -b)}Z`
  return `M${point(0, -b)}C${point(-w, -middle)} ${point(k - w * t, -r)} ${point(k, -r)}L${point(w + k, -middle)}Q${point(w * .2, -middle)} ${point(0, -b)}Z`
}

function polygon(sides: number, radius: number, inset = radius): string {
  const count = inset === radius ? sides : sides * 2
  return Array.from({length: count}, (_, i) => {
    const angle = i * Math.PI * 2 / count - Math.PI / 2
    const reach = i % 2 ? inset : radius
    return point(Math.cos(angle) * reach, Math.sin(angle) * reach)
  }).join(' ')
}

function kaleidoscopeGlyph(id: string): string {
  const random = seededRandom(id)
  const between = (min: number, max: number) => min + random() * (max - min)
  const choose = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!
  const hue = between(0, 360)
  const spread = choose([between(20, 55), between(135, 175), between(185, 220), between(100, 130)])
  const palette = [
    color(hue, between(65, 85), between(56, 67)),
    color(hue + spread, between(62, 82), between(57, 71)),
    color(hue + spread * .5, between(65, 85), between(50, 62)),
  ]
  const outline = color(hue, 48, 32)
  const highlight = color(hue + spread, 65, 88)
  const count = choose([4, 5, 6, 7, 8, 9, 10])
  const radius = between(12.1, 13.7)
  const width = Math.min(4.6, Math.sin(Math.PI / count) * radius * between(.7, 1.18))
  const outer: Petal = {profile: choose([0, 1, 2, 3, 4]), radius, base: between(1.4, 4.2), width, bend: between(-.65, .65), shoulder: between(.45, .78), tip: between(.18, .72)}
  const innerCount = choose([count, Math.max(3, Math.floor(count / 2)), count + 1])
  const innerRadius = between(5.3, 8.4)
  const inner: Petal = {profile: choose([0, 1, 2, 3, 4]), radius: innerRadius, base: between(.6, 1.8), width: Math.min(3.2, Math.sin(Math.PI / innerCount) * innerRadius * between(.7, 1.1)), bend: between(-.45, .45), shoulder: between(.42, .8), tip: between(.2, .7)}
  const rotation = between(0, 360)
  const offset = between(.18, .8) * 360 / innerCount
  const alternate = random() > .45
  const facet = random() > .5
  const outerPath = petalPath(outer)
  const innerPath = petalPath(inner)
  const outerRing = Array.from({length: count}, (_, i) => {
    const fill = palette[alternate ? i % 2 : 0]
    const accent = facet ? `<path d="M${point(0, -outer.base)}L${point(outer.bend, -radius * .9)} ${point(width * .65, -(outer.base + (radius - outer.base) * outer.shoulder))}Z" fill="${palette[2]}" stroke="none"/>` : ''
    return `<g transform="rotate(${number(i * 360 / count)})"><path d="${outerPath}" fill="${fill}"/>${accent}</g>`
  }).join('')
  const innerRing = Array.from({length: innerCount}, (_, i) => `<path d="${innerPath}" transform="rotate(${number(offset + i * 360 / innerCount)})" fill="${palette[(i + 1) % 3]}"/>`).join('')
  const coreRadius = between(1.9, 3)
  const core = choose([0, 1, 2])
  const center = core === 0
    ? `<circle r="${number(coreRadius)}" fill="${palette[2]}"/>`
    : `<polygon points="${polygon(choose([3, 4, 5, 6]), coreRadius, core === 2 ? coreRadius * between(.42, .65) : coreRadius)}" fill="${palette[2]}"/>`
  // Opaque colors and a dark/light edge remain legible on both light and dark surfaces.
  // All geometry stays inside a 15-unit radius, including the outline, without filters or remote assets.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g transform="translate(16 16) rotate(${number(rotation)})" stroke="${outline}" stroke-width=".8" stroke-linejoin="round">${outerRing}${innerRing}<g stroke="${highlight}" stroke-width=".85">${center}<circle r=".65" fill="${outline}" stroke="none"/></g></g></svg>`
}

function generatedGlyph(id:string,style:Exclude<SubchatGlyphStyle,'mixed'|'kaleidoscope'>):string{
  const random=seededRandom(id,style),between=(min:number,max:number)=>min+random()*(max-min)
  const hue=between(0,360),spread=between(85,215),palette=[color(hue,74,61),color(hue+spread,68,67),color(hue+spread*.48,79,53)]
  const edge=color(hue,36,29),light=color(hue+spread,55,91)
  let artwork=''
  if(style==='origami'){
    const count=5+Math.floor(random()*4),rotation=between(0,360),center={x:between(-2.4,2.4),y:between(-2.4,2.4)}
    const corners=Array.from({length:count},(_,index)=>{const angle=(rotation+index*360/count+between(-10,10))*Math.PI/180,radius=between(9.5,13.6);return{x:Math.cos(angle)*radius,y:Math.sin(angle)*radius}})
    artwork=corners.map((corner,index)=>{const next=corners[(index+1)%count]!;return `<path d="M${point(center.x,center.y)}L${point(corner.x,corner.y)} ${point(next.x,next.y)}Z" fill="${palette[index%3]}"/>`}).join('')
    const fold=corners[Math.floor(random()*count)]!
    artwork+=`<path d="M${point(center.x,center.y)}L${point(fold.x,fold.y)} ${point(fold.x*.36-3.6,fold.y*.36+4)}Z" fill="${light}" opacity=".84"/><path d="M${point(center.x,center.y)}L${point(fold.x*.5+4,fold.y*.5-3)} ${point(fold.x,fold.y)}" fill="none" stroke="${light}"/>`
  }else if(style==='sigil'){
    const count=3+Math.floor(random()*4),rotation=between(0,360),radius=between(10.4,12.4),gap=between(12,28)
    for(let index=0;index<count;index++){
      const from=(rotation+index*360/count+gap/2)*Math.PI/180,to=(rotation+(index+1)*360/count-gap/2)*Math.PI/180
      artwork+=`<path d="M${point(Math.cos(from)*radius,Math.sin(from)*radius)}A${number(radius)} ${number(radius)} 0 0 1 ${point(Math.cos(to)*radius,Math.sin(to)*radius)}" stroke="${edge}" stroke-width="3.6" fill="none"/><path d="M${point(Math.cos(from)*radius,Math.sin(from)*radius)}A${number(radius)} ${number(radius)} 0 0 1 ${point(Math.cos(to)*radius,Math.sin(to)*radius)}" stroke="${palette[index%3]}" stroke-width="2" fill="none"/>`
    }
    const sides=3+Math.floor(random()*4),core=between(4.8,7),innerRotation=between(0,360)
    artwork+=`<g transform="rotate(${number(innerRotation)})"><polygon points="${polygon(sides,core)}" fill="${palette[2]}"/><polygon points="${polygon(sides,core*.45)}" fill="${light}"/></g>`
    for(let index=0;index<3;index++){const angle=(rotation+index*120+between(-15,15))*Math.PI/180,reach=between(7.2,8.7);artwork+=`<circle cx="${number(Math.cos(angle)*reach)}" cy="${number(Math.sin(angle)*reach)}" r="${number(between(.8,1.25))}" fill="${palette[index]}"/>`}
  }else if(style==='sprout'){
    const lean=between(-4.6,4.6),rotation=between(-32,32),count=3+Math.floor(random()*3)
    let leaves=`<path d="M0 12Q${point(lean,-1)} ${point(lean*.6,-12)}" stroke="${edge}" stroke-width="2.4" fill="none"/><path d="M0 12Q${point(lean,-1)} ${point(lean*.6,-12)}" stroke="${palette[2]}" stroke-width="1" fill="none"/>`
    for(let index=0;index<count;index++){
      const fraction=(index+1)/(count+1),x=lean*Math.sin(fraction*Math.PI)*.7,y=10-fraction*22,side=index%2?-1:1,length=between(5.4,8.2),width=between(2.3,4),angle=side*between(36,78)
      leaves+=`<g transform="translate(${point(x,y)}) rotate(${number(angle)})"><path d="M0 0C${point(-width,-length*.2)} ${point(-width,-length*.8)} ${point(0,-length)}C${point(width,-length*.8)} ${point(width,-length*.2)} 0 0Z" fill="${palette[index%3]}"/><path d="M0 -1L${point(0,-length*.78)}" stroke="${light}" stroke-width=".65"/></g>`
    }
    artwork=`<g transform="rotate(${number(rotation)})">${leaves}</g>`
  }else{
    const count=1+Math.floor(random()*3),rotation=between(0,180)
    for(let index=0;index<count;index++){
      const angle=rotation+index*between(48,95),rx=between(10.5,12.7),ry=between(3.7,7.2),phase=between(0,Math.PI*2),satellite=between(1.1,1.7)
      artwork+=`<g transform="rotate(${number(angle)})"><ellipse rx="${number(rx)}" ry="${number(ry)}" stroke="${edge}" stroke-width="2.6" fill="none"/><ellipse rx="${number(rx)}" ry="${number(ry)}" stroke="${palette[index%3]}" stroke-width="1.25" fill="none"/><circle cx="${number(Math.cos(phase)*rx)}" cy="${number(Math.sin(phase)*ry)}" r="${number(satellite)}" fill="${light}"/></g>`
    }
    const radius=between(3.4,5.2)
    artwork+=`<circle r="${number(radius)}" fill="${palette[0]}"/><path d="M${point(-radius*.6,-radius*.2)}Q${point(-radius*.25,-radius*.8)} ${point(radius*.3,-radius*.65)}" stroke="${light}" stroke-width="1.2" fill="none"/>`
    if(random()>.5)artwork+=`<polygon points="${polygon(4,2,.7)}" transform="translate(${point(between(-8,-5),between(-9,-6))}) rotate(20)" fill="${palette[1]}"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g transform="translate(16 16)" stroke="${edge}" stroke-width=".8" stroke-linecap="round" stroke-linejoin="round">${artwork}</g></svg>`
}

export function subchatGlyph(id:string,preference:SubchatGlyphStyle='mixed'):string{
  const selected=resolveSubchatGlyphStyle(preference)
  const families=['origami','sigil','sprout','orbit','kaleidoscope'] as const
  const style=selected==='mixed'?families[Math.floor(seededRandom(id,'mixed')()*families.length)]!:selected
  return style==='kaleidoscope'?kaleidoscopeGlyph(id):generatedGlyph(id,style)
}
export function subchatGlyphUrl(id:string,style:SubchatGlyphStyle='mixed'):string{
  return `data:image/svg+xml,${encodeURIComponent(subchatGlyph(id,style))}`
}
