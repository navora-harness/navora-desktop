import {test} from 'node:test'
import assert from 'node:assert/strict'
import {appearancePalette, resolveAppearanceTheme, resolveAppearanceMode, APPEARANCE_THEMES} from './appearance'

test('automatic appearance follows the system, explicit modes override it for every theme',()=>{
  for(const theme of APPEARANCE_THEMES){
    assert.equal(appearancePalette(theme.id,'auto',false).dark,false)
    assert.equal(appearancePalette(theme.id,'auto',true).dark,true)
    assert.equal(appearancePalette(theme.id,'light',true).dark,false)
    assert.equal(appearancePalette(theme.id,'dark',false).dark,true)
    assert.notEqual(appearancePalette(theme.id,'dark',false).shell,theme.shell)
  }
})
test('legacy and invalid preferences resolve to a usable automatic mist theme',()=>{
  for(const value of [undefined,null,'missing',{}]){
    assert.equal(resolveAppearanceTheme(value).id,'mist')
    assert.equal(resolveAppearanceMode(value),'auto')
    assert.equal(appearancePalette(value,value,true).dark,true)
  }
})

function luminance(hex:string) {
  const [r,g,b]=hex.slice(1).match(/../g)!.map(channel=>{
    const value=parseInt(channel,16)/255
    return value<=.04045?value/12.92:((value+.055)/1.055)**2.4
  })
  return r!*.2126+g!*.7152+b!*.0722
}
function contrast(a:string,b:string) {
  const values=[luminance(a),luminance(b)].sort((x,y)=>y-x)
  return (values[0]!+.05)/(values[1]!+.05)
}
test('all themes keep hover text readable and distinguish hover from idle and selected states',()=>{
  for(const theme of APPEARANCE_THEMES)for(const mode of ['light','dark'] as const){
    const palette=appearancePalette(theme.id,mode,false)
    assert.ok(contrast(palette.hoverInk,palette.hover)>=4.5,theme.id+' '+mode+' hover text')
    assert.ok(contrast(palette.hoverInk,palette.selectedHover)>=4.5,theme.id+' '+mode+' selected hover text')
    assert.ok(contrast(palette.hover,palette.surface)>=1.2,theme.id+' '+mode+' visible background change')
    assert.notEqual(palette.hover,palette.selection)
    assert.notEqual(palette.selectedHover,palette.selection)
    assert.notEqual(palette.hoverBorder,palette.stroke)
  }
})
