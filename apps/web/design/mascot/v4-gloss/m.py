# v4 ghost: clean geometry, few anchors
SH={
 'B1 Boo':"M44 10C64 10 80 26 80 46C80 58 77 67 72 74C80 82 90 82 96 72C98 68 104 68 104 74C104 90 90 102 70 103C62 104 54 104 46 104C22 104 8 86 8 50C8 28 24 10 44 10Z",
 'B2 Round Boo':"M46 8C68 8 84 25 84 47C84 60 81 69 76 76C83 82 92 81 97 73C99 69 105 70 104 77C102 92 89 103 70 104C62 105 54 105 46 105C22 105 7 87 7 49C7 26 24 8 46 8Z",
 'B3 High wisp':"M44 12C63 12 78 27 78 46C78 58 75 67 70 74C79 81 91 78 97 64C99 59 105 60 105 67C105 90 90 102 70 103C62 104 54 104 46 104C23 104 9 87 9 51C9 29 25 12 44 12Z",
 'C2 Soft-serve':"M55 6C76 6 93 23 93 45C93 68 80 86 66 95C60 100 52 104 43 105C35 106 30 101 33 96C36 92 41 93 45 91C29 87 17 71 17 45C17 23 34 6 55 6Z",
}
POS={'B1 Boo':(44,54),'B2 Round Boo':(46,53),'B3 High wisp':(44,55),'C2 Soft-serve':(55,50)}
MIRROR={'B3 High wisp':True}
COL={
 'coral':('#f8b3a6','#e2705e','#b44a3c','#2a100c'),
 'mint':('#d2f4e2','#7fd0a5','#4a9a73','#0f2419'),
 'blue':('#d1e1ff','#7fa7ec','#4b6fb5','#0f1a2e'),
 'black':('#050505','#050505','#050505','#050505'),
}
def eyesA(expr,cx=46,cy=55):
    # two small marks, Grok vocabulary; returns svg elements
    g=10; out=[]
    def rr(x,y,w,h,rot=0):
        t=f' transform="rotate({rot} {x} {y})"' if rot else ''
        return f'<rect x="{x-w/2:.1f}" y="{y-h/2:.1f}" width="{w}" height="{h}" rx="{min(w,h)/2:.1f}"{t} fill="EYE"/>'
    L,R=cx-g/2,cx+g/2
    if expr=='neutral': out=[rr(L,cy,4.6,9),rr(R,cy,4.6,9)]
    elif expr=='happy': out=[rr(L,cy,8,3.6),rr(R,cy,8,3.6)]
    elif expr=='sleepy': out=[rr(L,cy+3,4,3.4),rr(R,cy+3,4,3.4)]
    elif expr=='surprised': out=[rr(L,cy,7,7),rr(R,cy,7,7)]
    elif expr=='curious': out=[rr(L+2,cy-3,4.6,9,20),rr(R+2,cy-3,4.6,9,20)]
    return ''.join(out)
def eyeB(expr,cx=48,cy=54):
    u=2.2
    def poly(pts): return '<path d="M'+' L'.join(f'{cx+x*u:.2f} {cy+y*u:.2f}' for x,y in pts)+'Z" fill="EYE" stroke="EYE" stroke-width="1.2" stroke-linejoin="round"/>'
    lens=[(-2.5,-2),(2.5,-2),(2.5,-1),(3.5,-1),(3.5,1),(2.5,1),(2.5,2),(-2.5,2),(-2.5,1),(-3.5,1),(-3.5,-1),(-2.5,-1)]
    if expr=='neutral': return poly(lens)
    if expr=='surprised':
        return poly([(-2,-3.2),(2,-3.2),(2,-2.2),(3,-2.2),(3,2.2),(2,2.2),(2,3.2),(-2,3.2),(-2,2.2),(-3,2.2),(-3,-2.2),(-2,-2.2)])
    if expr=='happy':
        return poly([(-3.5,1.4),(-3.5,-0.2),(-2.5,-0.2),(-2.5,-1.4),(2.5,-1.4),(2.5,-0.2),(3.5,-0.2),(3.5,1.4),(2.3,1.4),(2.3,0.7),(1.4,0.7),(1.4,-0.1),(-1.4,-0.1),(-1.4,0.7),(-2.3,0.7),(-2.3,1.4)])
    if expr=='sleepy':
        return poly([(-3.2,1.2),(3.2,1.2),(3.2,2.2),(-3.2,2.2)])
    if expr=='curious':
        return poly([(x*0.8+1.3,y*0.8-1.4) for x,y in lens])
def ghost_svg(shape,col='coral',face='A',expr='neutral',size=160,flat=False):
    hi,base,lo,eye=COL[col]
    d=SH[shape]; mir=MIRROR.get(shape,False)
    tr=' transform="translate(110 0) scale(-1 1)"' if mir else ''
    gid=f'g{abs(hash((shape,col,face,expr)))%999999}'
    cx,cy=POS[shape]
    if mir: cx=110-cx
    if col=='black' or flat:
        return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 110 110"><path d="{d}" fill="{base}"{tr}/></svg>'
    gx=0.36 if not mir else 0.42
    defs=(f'<defs><radialGradient id="{gid}" cx="{gx}" cy="0.3" r="0.8"><stop offset="0" stop-color="{hi}"/>'
          f'<stop offset="0.42" stop-color="{base}"/><stop offset="1" stop-color="{lo}"/></radialGradient>'
          f'<radialGradient id="{gid}s" cx="{gx-0.03}" cy="0.22" r="0.22"><stop offset="0" stop-color="#ffffff" stop-opacity="0.5"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>')
    body=defs+f'<path d="{d}" fill="url(#{gid})"{tr}/><path d="{d}" fill="url(#{gid}s)"{tr}/>'
    f=eyesA(expr,cx-1,cy) if face=='A' else eyeB(expr,cx,cy)
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 110 110">{body}{f.replace("EYE",eye)}</svg>'
