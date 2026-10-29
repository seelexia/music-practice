"""Independent synthetic notation images; never reads songs, reference HTML or runtime.
Expected symbols are kept in an offline HTML adapter input, not supplied to the VLM.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

def create(output):
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    cases=[('serif','times.ttf','D',[(1,0,0,False),(5,1,1,False),(3,-1,1,False),(0,0,0,False)]),
           ('sans','arial.ttf','Eb',[(6,-1,1,True),(2,0,2,False),(4,1,0,False),(7,0,0,False)])]
    for name,font,key,pattern in cases:
        image=Image.new('RGB',(1100,650),'white');draw=ImageDraw.Draw(image)
        notes_font=ImageFont.truetype('C:/Windows/Fonts/'+font,42)
        header_font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',28)
        draw.text((60,30),'Independent notation fixture '+name,fill='black',font=header_font)
        draw.text((60,90),f'1={key}      3/4      quarter note = 96',fill='black',font=header_font)
        rows=[]
        for row,y in enumerate([210,430],1):
            entries=[]
            for measure,start in enumerate([70,590]):
                # Four musical events, always 3 quarter beats; font-specific cases are independent.
                seq=pattern if name=='serif' else pattern
                for i,(degree,octave,beams,dotted) in enumerate(seq):
                    x=start+i*100;draw.text((x,y),str(degree),fill='black',font=notes_font)
                    for beam in range(beams):draw.line((x-2,y+49+beam*6,x+28,y+49+beam*6),fill='black',width=2)
                    if octave:draw.ellipse((x+10,y-10 if octave>0 else y+67,x+15,y-5 if octave>0 else y+72),fill='black')
                    if dotted:draw.ellipse((x+33,y+27,x+38,y+32),fill='black')
                    entries.append({'x':x,'pitch':str(degree),'octave':octave,'beams':beams,'dotted':dotted,'lyric':''})
                draw.line((start+420,y-15,start+420,y+80),fill='black',width=2)
            rows.append({'page':1,'row':row,'bars':[490,1010],'measure_beats':[3,3],'notes':entries})
        image.save(output/(name+'.png'))
        data={'title':'Synthetic '+name,'key':key,'tempo':96,'time_signature':'3/4','rows':rows}
        (output/(name+'.html')).write_text('<script id="scoreData" type="application/json">'+json.dumps(data)+'</script>',encoding='utf-8')
    print('Created two independent fonts/keys/layout fixture images and offline references')

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('output');create(p.parse_args().output)
