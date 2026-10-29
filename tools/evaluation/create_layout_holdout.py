"""Additional offline-only visual holdouts, independent of any user song.
Never import this module from recognition workers. The renderer owns the answer;
only generated PNGs may be supplied to recognition, after its prompt is frozen.
"""
import json,random
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont

def generate(output):
    rng=random.Random(581926)
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    patterns=[[(0,False,0),(1,False,0),(1,False,0),(0,False,1)],
              [(1,False,0)]*4+[(0,False,0)]*2,
              [(1,True,0),(2,False,0),(0,False,0),(0,False,1)],
              [(0,False,1),(0,False,0),(0,False,0)]]
    rows=[]
    for page,(width,height,fontname,fontsize,row_groups) in enumerate([
        (1280,820,'calibri.ttf',40,[2,2]),
        (870,1420,'georgia.ttf',48,[1,1,1,1])],1):
        image=Image.new('RGB',(width,height),'white');d=ImageDraw.Draw(image)
        font=ImageFont.truetype('C:/Windows/Fonts/'+fontname,fontsize)
        label=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',max(20,fontsize//2))
        d.text((35,28),f'Independent held-out page {page}',font=label,fill='black')
        d.text((35,75),'1=F#    4/4    quarter note = 104',font=label,fill='black')
        for ri,count in enumerate(row_groups,1):
            y=180+(ri-1)*(height-240)/len(row_groups)
            notes=[];bars=[]
            for measure in range(count):
                start=40+measure*(width-80)/count;span=(width-80)/count
                specs=patterns[(ri+measure+page)%len(patterns)]
                glyph_count=sum(1+e for _,_,e in specs)
                gap=(span-60)/glyph_count;slot=0
                for beams,dotted,extensions in specs:
                    degree=rng.randrange(8);octave=0 if degree==0 else rng.choice([-1,0,0,0,1])
                    x=start+slot*gap;slot+=1
                    d.text((x,y),str(degree),font=font,fill='black')
                    base=y+fontsize*1.08
                    for b in range(beams):d.line((x-1,base+b*6,x+fontsize*.65,base+b*6),fill='black',width=2)
                    if dotted:d.ellipse((x+fontsize*.75,y+fontsize*.45,x+fontsize*.85,y+fontsize*.55),fill='black')
                    if octave:
                        dot_y=y-fontsize*.17 if octave>0 else base+beams*6+fontsize*.26
                        d.ellipse((x+fontsize*.22,dot_y,x+fontsize*.33,dot_y+fontsize*.11),fill='black')
                    notes.append({'x':x,'pitch':str(degree),'octave':octave,'beams':beams,'dotted':dotted,'lyric':''})
                    for _ in range(extensions):
                        ex=start+slot*gap;slot+=1;d.text((ex,y),'–',font=font,fill='black')
                        notes.append({'x':ex,'pitch':'-','octave':0,'beams':0,'dotted':False,'lyric':''})
                end=start+span-18;d.line((end,y-10,end,y+fontsize*1.9),fill='black',width=2);bars.append(end)
            rows.append({'page':page,'row':ri,'bars':bars,'notes':notes,'measure_beats':[4]*count})
        image.save(output/f'page-{page}.png')
    data={'title':'Independent layout holdout','key':'F#','tempo':104,'time_signature':'4/4','rows':rows}
    (output/'reference.html').write_text('<script id="scoreData" type="application/json">'+json.dumps(data)+'</script>',encoding='utf-8')
    print('Independent PNG-only inputs and an isolated answer created')

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('output');generate(p.parse_args().output)
