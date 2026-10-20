import math, sys
sys.path.insert(0,__import__('os').path.dirname(__file__))
import s5
C=6
def full(a,b): return [(a,b)]
DOME=[[(5,10)],[(3,12)],[(2,13)],[(1,14)]]
BODIES={
 'baseline':DOME+[[(0,15)]]*11+[[(0,2),(4,6),(9,11),(13,15)]]*2,
 'chunky':[[(4,11)],[(4,11)],[(2,13)],[(2,13)]]+[[(0,15)]]*9+[[(0,3),(6,9),(12,15)]]*2,
 'logohem':DOME+[[(0,15)]]*10+[[(2,13)]]*2+[[(6,9)]]*2,
 'drip':DOME+[[(0,15)]]*10+[[(0,4),(7,15)]]+[[(0,1),(9,14)]]+[[(10,12)]]+[[(10,11)]]*2,
 'pixeleyes':DOME+[[(0,15)]]*11+[[(0,2),(4,6),(9,11),(13,15)]]*2,
 'logoeye':DOME+[[(0,15)]]*11+[[(0,2),(4,6),(9,11),(13,15)]]*2,
}
NAMES={'baseline':'1 · Baseline','chunky':'2 · Chunkier','logohem':'3 · Logo hem','drip':'4 · Drip hem','pixeleyes':'5 · Pixel eyes','logoeye':'6 · Single logo eye'}
def cells_of(rows):
    out=set()
    for y,spans in enumerate(rows):
        for a,b in spans:
            for x in range(a,b+1): out.add((x,y))
    return out
def rects(cells,ox=0,oy=0):
    cells=set(cells); rows={}
    for x,y in cells: rows.setdefault(y,[]).append(x)
    d=''
    for y in sorted(rows):
        xs=sorted(rows[y]); i=0
        while i<len(xs):
            st=xs[i]
            while i+1<len(xs) and xs[i+1]==xs[i]+1: i+=1
            d+=f"M{ox+st*C} {oy+y*C}h{(xs[i]-st+1)*C}v{C}h-{(xs[i]-st+1)*C}z"; i+=1
    return d
# pixel eye shapes (cells relative), left eye; right = mirrored unless noted
def grid(rows): return [(x,y) for y,r in enumerate(rows) for x,ch in enumerate(r) if ch=='#']
PX={
 'neutral':grid([".###","####","####","####","####","###."]),
 'angry':grid(["#...","##..","###.","####",".##."]),
 'happy':grid([".##.","####"]),
 'sleepy':grid(["##..","..##"]),
}
YOFF={'neutral':0,'angry':1,'happy':2,'sleepy':3}
def pixel_face(expr,bx,by):
    key='neutral' if expr=='talking' else expr
    L=PX[key]; out=set(); oy=by+YOFF[key]
    for x,y in L: out.add((3+x,oy+y))
    if key in ('neutral','sleepy'):
        for x,y in L: out.add((9+x,oy+y))
    else:
        for x,y in L: out.add((9+3-x,oy+y))
    return out
LOGO=[(40.545,234.355),(30.431,234.355),(30.431,228.644),(10.134,228.644),(10.134,218.473),(0,218.473),(0,208.301),(10.134,208.301),(10.134,198.13),(30.431,198.13),(30.431,192.501),(40.545,192.501),(40.545,198.13),(60.804,198.13),(60.804,208.301),(70.939,208.301),(70.939,218.473),(60.804,218.473),(60.804,228.644),(40.545,228.644)]
def logo_eye(expr,cx,cy,w=58):
    k=w/70.939
    def tf(pts): return [(cx+(x-35.47)*k, cy+(y-213.43)*k) for x,y in pts]
    cut=[]; isl=[]
    if expr in('neutral','talking'):
        cut=[tf(LOGO)]; isl=[s5.rrect(cx,cy,9*k*1.4,18*k*1.4,2*k)]
    elif expr=='angry':
        cut=[tf([(0,218.473),(0,208.301),(10.134,208.301),(10.134,203),(30.4,203),(40.5,208.3),(60.804,215),(70.939,215),(70.939,218.473),(60.804,218.473),(60.804,228.644),(40.545,228.644),(40.545,234.355),(30.431,234.355),(30.431,228.644),(10.134,228.644),(10.134,218.473)])]
        isl=[s5.rrect(cx-2*k,cy+6*k,9*k*1.4,12*k*1.4,2*k)]
    elif expr=='happy':
        cut=[tf([(0,222),(0,208.301),(10.134,208.301),(10.134,198.13),(30.431,198.13),(30.431,192.501),(40.545,192.501),(40.545,198.13),(60.804,198.13),(60.804,208.301),(70.939,208.301),(70.939,222),(58,222),(58,214),(48,214),(48,206),(23,206),(23,214),(13,214),(13,222)])]
    elif expr=='sleepy':
        cut=[tf([(0,214),(70.939,214),(70.939,221),(0,221)])]
    return cut,isl
def svg(body,expr='neutral',fill='#0a0a0a',size=160,rot=-4,prop=False):
    rows=BODIES[body]; cells=cells_of(rows)
    W=16*C; H=len(rows)*C
    ox=(110-W)/2; oy=(110-H)/2+4
    ecx=ox+W/2; ecy=oy+H*0.38
    cut_paths=[]; island=''
    if body=='pixeleyes':
        bx=8; by=4
        ec=pixel_face(expr,bx,by)
        cells=cells-ec
    elif body=='logoeye':
        cut,isl=logo_eye(expr,ecx,ecy)
        cut_paths=[s5.P(c) for c in cut]
        island=''.join(s5.P(i) for i in isl)
    else:
        E=s5.face(expr,cx=ecx,cy=ecy,s=1.18,tilt=-8)
        cut_paths=[s5.P(e) for e in E]
    mid=f'm{abs(hash((body,expr,fill,size)))%999999}'
    mask=(f'<mask id="{mid}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="150" height="150"><rect x="-20" y="-20" width="150" height="150" fill="#fff"/>'
          + (f'<path d="{"".join(cut_paths)}" fill="#000"/>' if cut_paths else '') + '</mask>')
    g=f'<g transform="rotate({rot} 55 55)"><path d="{rects(cells,ox,oy)}" fill="{fill}" mask="url(#{mid})"/>'
    if island: g+=f'<path d="{island}" fill="{fill}"/>'
    g+='</g>'
    extra=''
    if expr=='sleepy': extra+='<path d="'+''.join(s5.P(z) for z in s5.zz(86,2,1.6))+f'" fill="{fill}"/>'
    if expr=='talking':
        b,t,dots=s5.bubble(92,4,1.0)
        extra+=f'<path d="{s5.P(b)}{s5.P(t)}{"".join(s5.P(q) for q in dots)}" fill="{fill}" fill-rule="evenodd"/>'
    if prop: extra+=f'<rect x="{ox+W+4}" y="{oy+H-12}" width="12" height="12" fill="{fill}" transform="rotate(-4 {ox+W+10} {oy+H-6})"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="-6 -6 122 122"><defs>{mask}</defs>{g}{extra}</svg>'
