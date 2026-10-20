import math
def arcpts(cx,cy,r,a0,a1,n=14):
    return [(cx+r*math.cos(a0+(a1-a0)*i/n), cy+r*math.sin(a0+(a1-a0)*i/n)) for i in range(n+1)]
def rrect(cx,cy,w,h,r,rot=0,n=8):
    r=min(r,w/2,h/2); pts=[]
    for (qx,qy,a) in [(w/2-r,-h/2+r,-math.pi/2),(w/2-r,h/2-r,0),(-w/2+r,h/2-r,math.pi/2),(-w/2+r,-h/2+r,math.pi)]:
        pts+=arcpts(qx,qy,r,a,a+math.pi/2,n)
    return rot_pts(pts,rot,cx,cy)
def rot_pts(pts,deg,cx,cy):
    a=math.radians(deg); c,s=math.cos(a),math.sin(a)
    return [(cx+x*c-y*s, cy+x*s+y*c) for x,y in pts]
def P(pts): return "M"+" L".join(f"{x:.2f} {y:.2f}" for x,y in pts)+"Z"
# ---------- bodies (100x100 box, centre 50,50) ----------
def edge_with_bites(p0,p1,n,r,inward=True,bulge=False):
    # walk p0->p1, n bites evenly; bites cut toward the inside (left of direction for CW path)
    x0,y0=p0; x1,y1=p1; L=math.dist(p0,p1); dx,dy=(x1-x0)/L,(y1-y0)/L
    nx,ny=-dy,dx  # for clockwise path in screen coords, inside is to the right: (dy,-dx)? compute: dir (1,0) top edge -> inside is +y = (0,1) = (-dy,dx)? (-0,1) yes
    pts=[p0]; step=L/n
    for i in range(n):
        c=step*(i+0.5)
        cx,cy=x0+dx*c,y0+dy*c
        ang=math.atan2(dy,dx)
        if not bulge:
            # semicircle toward inside: from (c-r) to (c+r) going through inside
            a0=ang+math.pi; arc=[(cx+r*math.cos(a0-t*math.pi*-1*0+0), 0) for t in []]
            seg=[]
            for k in range(15):
                t=math.pi*k/14
                # start at -dir, rotate through inside normal to +dir
                vx=-math.cos(t); vy=math.sin(t)  # local: along=-cos, normal=+sin
                seg.append((cx+dx*r*vx+nx*r*vy, cy+dy*r*vx+ny*r*vy))
        else:
            seg=[]
            for k in range(15):
                t=math.pi*k/14
                vx=-math.cos(t); vy=-math.sin(t)
                seg.append((cx+dx*r*vx+nx*r*vy, cy+dy*r*vx+ny*r*vy))
        pts+=seg
    return pts
def stamp(w=80,h=84,n=5,r=4.6):
    x0,y0=50-w/2,50-h/2; x1,y1=50+w/2,50+h/2; cr=2.5
    pts=[]
    pts+=edge_with_bites((x0,y0),(x1,y0),n,r)
    pts+=edge_with_bites((x1,y0),(x1,y1),n,r)
    pts+=edge_with_bites((x1,y1),(x0,y1),n,r)
    pts+=edge_with_bites((x0,y1),(x0,y0),n,r)
    return pts
def hybrid(w=80,h=86,n=5,r=4.6):
    x0,y0=50-w/2,50-h/2; x1,y1=50+w/2,50+h/2
    pts=[]
    pts+=edge_with_bites((x0,y0),(x1,y0),n,r)
    pts+=edge_with_bites((x1,y0),(x1,y1-6),4,r)
    # bottom: bulging scallops (bedsheet hem)
    pts+=edge_with_bites((x1,y1-6),(x0,y1-6),4,w/8,bulge=True)
    pts+=edge_with_bites((x0,y1-6),(x0,y0),4,r)
    return pts
def bedsheet(w=80,h=88,r=4.6):
    x0,x1=50-w/2,50+w/2; top=50-h/2; bot=50+h/2
    R=w/2; cy=top+R
    pts=arcpts(50,cy,R,math.pi,2*math.pi,24)
    # right side down
    pts+=[(x1,bot)]
    # hem: bites same as stamp perforations but bigger count
    pts+=edge_with_bites((x1,bot),(x0,bot),5,4.6)
    pts+=[(x0,cy)]
    return pts
def arcade(w=80,h=86):
    # blocky dome (steps), straight sides, 3-tooth stepped hem; unit u
    u=w/10; x0=50-w/2; t=50-h/2; b=50+h/2
    X=lambda i:x0+i*u
    pts=[(X(3),t),(X(7),t),(X(7),t+u),(X(9),t+u),(X(9),t+2*u),(X(10),t+2*u),(X(10),b),
         (X(9),b),(X(9),b-u),(X(8),b-u),(X(8),b),(X(6.67),b),(X(6.67),b-u),(X(5.67),b-u),(X(5.67),b),  # teeth
         ]
    # simpler symmetric teeth: 4 teeth
    pts=[(X(2),t),(X(8),t),(X(8),t+u),(X(9),t+u),(X(9),t+2*u),(X(10),t+2*u),(X(10),b),
         (X(8.5),b),(X(8.5),b-u),(X(7),b-u),(X(7),b),(X(5.75),b),(X(5.75),b-u),(X(4.25),b-u),(X(4.25),b),(X(3),b),(X(3),b-u),(X(1.5),b-u),(X(1.5),b),(X(0),b),
         (X(0),t+2*u),(X(1),t+2*u),(X(1),t+u),(X(2),t+u)]
    return pts
def flame():
    # candle-flame wisp: round bottom, soft tip on top leaning right
    R=36; cx,cy=48,58
    def bez(p0,p1,p2,p3,n=24):
        out=[]
        for i in range(1,n+1):
            t=i/n; u_=1-t
            out.append((u_**3*p0[0]+3*u_*u_*t*p1[0]+3*u_*t*t*p2[0]+t**3*p3[0], u_**3*p0[1]+3*u_*u_*t*p1[1]+3*u_*t*t*p2[1]+t**3*p3[1]))
        return out
    # bottom arc from right (angle -10deg) clockwise through bottom to left (190deg)
    pts=arcpts(cx,cy,R,math.radians(-15),math.radians(195),40)
    L=pts[-1]; Rr=pts[0]; tip=(70,2)
    pts+=bez(L,(cx-R-1,cy-34),(40,4),tip)       # left edge sweeps up to the tip
    pts+=bez(tip,(80,10),(88,24),Rr)              # right edge back down
    return pts
BODIES={'stamp':stamp,'arcade':arcade,'bedsheet':bedsheet,'flame':flame,'hybrid':hybrid}
# ---------- faces ----------
def face(expr,cx=50,cy=44,s=1.0,tilt=-8):
    E=[]; extra=[]
    g=13.5*s
    if expr=='neutral' or expr=='talking':
        E=[rrect(cx-g,cy,15.5*s,28*s,7.75*s,tilt),rrect(cx+g,cy,15.5*s,28*s,7.75*s,tilt)]
    elif expr=='angry':
        for side in (-1,1):
            ex=cx+side*g
            # wedge: top slants down toward middle, bottom rounded
            top_out=(ex+side*8*s, cy-8*s); top_in=(ex-side*8*s, cy+1*s)
            bottom=arcpts(ex,cy+3*s,8*s,0,math.pi,12)
            if side==1: pts=[top_in,top_out]+[ (x,y) for x,y in bottom]
            else: pts=[top_out,top_in]+[(2*ex-x,y) for x,y in bottom[::-1]][::-1]
            # ensure polygon order: build simply as hull: top line then bottom arc from right to left
            bx=sorted(bottom,key=lambda q:-q[0])
            left,right=(top_in,top_out) if side==1 else (top_out,top_in)
            pts=[left,right]+arcpts(ex,cy+3*s,8*s,0,math.pi,12)
            E.append(rot_pts([(x-cx,y-cy) for x,y in pts],tilt*0.4,cx,cy))
    elif expr=='happy':
        for side in (-1,1):
            ex=cx+side*g
            pts=arcpts(ex,cy+5*s,9*s,math.pi,2*math.pi,16)
            E.append(rot_pts([(x-cx,y-cy) for x,y in pts],tilt*0.4,cx,cy))
    elif expr=='sleepy':
        for side in (-1,1):
            E.append(rrect(cx+side*(g-1),cy+4*s,15*s,3.6*s,1.8*s,-14))
    return E
def zz(x,y,k):
    def Z(x,y,k):
        return [(x,y),(x+6*k,y),(x+6*k,y+1.6*k),(x+1.9*k,y+5.4*k),(x+6*k,y+5.4*k),(x+6*k,y+7*k),(x,y+7*k),(x,y+5.4*k),(x+4.1*k,y+1.6*k),(x,y+1.6*k)]
    return [Z(x,y,k*0.55),Z(x+5*k,y-6*k,k)]
def bubble(x,y,k=1):
    body=rrect(x,y,26*k,14*k,6*k)
    tail=[(x-8*k,y+5*k),(x-3*k,y+5*k),(x-11*k,y+12*k)]
    dots=[rrect(x+dx*k,y,3.4*k,3.4*k,1.7*k) for dx in (-6.5,0,6.5)]
    return body,tail,dots
def svg(body,expr='neutral',fill='#0a0a0a',bg=None,size=160,rot=-4,faceopt=None,prop=False):
    pts=BODIES[body]()
    fc=faceopt or {}
    E=face(expr,**fc)
    d=P(pts)+''.join(P(e) for e in E)
    parts=[f'<g transform="rotate({rot} 50 50)"><path d="{d}" fill="{fill}" fill-rule="evenodd"/></g>']
    if expr=='sleepy':
        parts.append('<path d="'+''.join(P(z) for z in zz(80,6,1.6))+f'" fill="{fill}"/>')
    if expr=='talking':
        b,t,dots=bubble(86,6,1.0)
        parts.append(f'<path d="{P(b)}{P(t)}{"".join(P(q) for q in dots)}" fill="{fill}" fill-rule="evenodd"/>')
    if prop:
        parts.append(f'<path d="{P(rrect(104,86,15,15,2.5,-3))}" fill="{fill}"/>')
    bgr=f'<rect x="-14" y="-14" width="128" height="128" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="-14 -14 128 128">{bgr}{"".join(parts)}</svg>'
