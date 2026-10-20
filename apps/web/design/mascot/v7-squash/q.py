import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s5
C=6
OUT=[(5,0),(11,0),(11,1),(13,1),(13,2),(14,2),(14,3),(15,3),(15,4),(16,4),(16,17),(13,17),(13,15),(12,15),(12,17),(9,17),(9,15),(7,15),(7,17),(4,17),(4,15),(3,15),(3,17),(0,17),(0,4),(1,4),(1,3),(2,3),(2,2),(3,2),(3,1),(5,1)]
W,H=16*C,17*C
def rest_outline():
    return [(x*C,y*C) for x,y in OUT]
def densify(pts,step=1.5):
    out=[]
    n=len(pts)
    for i in range(n):
        a=pts[i]; b=pts[(i+1)%n]
        L=math.dist(a,b); k=max(1,int(L/step))
        for j in range(k):
            t=j/k; out.append((a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t))
    return out
POSES={
 'rest':dict(),
 'anticipation':dict(sx=1.08,sy=0.9,bow=2.5,bowT=-1.5),
 'stretch':dict(sx=0.86,sy=1.15,lean=7,bow=-1.5,lift=12),
 'apex':dict(sx=0.98,sy=1.03,lean=-2,lift=20,bowT=1.5),
 'landing':dict(sx=1.18,sy=0.82,bow=5,bowT=6,keystone=0.07,lean=3,rot=4,cheek=True),
 'settle':dict(sx=0.96,sy=1.05,lean=-3,bow=-1),
 'bounce':dict(sx=1.08,sy=0.92,bow=2.5,bowT=3,lift=6,rot=-2,cheek=True),
 'slump':dict(sx=1.06,sy=0.9,lean=-9,bow=3,droop=5,rot=-3),
 'tall':dict(sx=0.88,sy=1.13,bow=-1.5,bowT=2,lift=4),
}
def warp_fn(p):
    sx=p.get('sx',1); sy=p.get('sy',1); lean=p.get('lean',0); bow=p.get('bow',0); bowT=p.get('bowT',0)
    ks=p.get('keystone',0); lift=p.get('lift',0); rot=math.radians(p.get('rot',0)); droop=p.get('droop',0)
    cx=W/2
    def f(x,y):
        v=y/H  # 0 top .. 1 bottom
        u=(x-cx)/(W/2)
        # keystone: bottom wider
        kx=1+ks*(v-0.5)*2
        nx=cx+(x-cx)*sx*kx
        ny=H-(H-y)*sy
        # sides bow outward (bow>0) with sin profile over height
        nx+=bow*math.sin(math.pi*v)*u
        # top edge convex
        ny-=bowT*(1-v)**2*(1-u*u)
        # lean: top shifts
        nx+=lean*(1-v)
        # droop: one side sags (right side lower)
        ny+=droop*(1-v)*max(0,u)
        ny-=lift
        if rot:
            ox,oy=cx,H
            dx,dy=nx-ox,ny-oy
            nx=ox+dx*math.cos(rot)-dy*math.sin(rot); ny=oy+dx*math.sin(rot)+dy*math.cos(rot)
        return nx,ny
    return f
def cheek_clamp(eye,ex,ecy,ew,eh,amt):
    out=[]
    base=ecy+eh*0.5
    for x,y in eye:
        t=(x-ex)/(ew*0.75)
        yc=base-amt*(1-min(1,t*t))
        out.append((x,min(y,yc)))
    return out
def build(expr='neutral',pose='rest'):
    p=POSES[pose]; f=warp_fn(p)
    body=rest_outline() if pose=='rest' else densify(rest_outline())
    ecx=W/2; ecy=H*0.36
    s=1.18
    if expr=='surprised':
        g=14*s
        E=[s5.rrect(ecx-g,ecy,17*s,24*s,8.5*s,0),s5.rrect(ecx+g,ecy,17*s,24*s,8.5*s,0)]
    else:
        E=s5.face(expr,cx=ecx,cy=ecy,s=s,tilt=-6 if expr in('neutral','talking') else -8)
    if p.get('cheek') and expr in('neutral','talking','happy'):
        g=13.5*s; ew=15.5*s; eh=28*s
        if expr=='happy':
            E=[cheek_clamp(densify(e,0.8),ecx+side*g,ecy+5*s,18*s,10*s,4.5*s) for side,e in zip((-1,1),E)]
        else:
            E=[cheek_clamp(densify(e,0.8),ecx+side*g,ecy,ew,eh,9*s) for side,e in zip((-1,1),E)]
    if pose!='rest':
        body=[f(x,y) for x,y in body]
        E=[[f(x,y) for x,y in densify(e,0.8)] for e in E]
    return body,E
def svg(expr='neutral',pose='rest',fill='#0a0a0a',size=160,prop=False):
    body,E=build(expr,pose)
    mid=f'm{abs(hash((expr,pose,fill,size)))%9999999}'
    mask=(f'<mask id="{mid}" maskUnits="userSpaceOnUse" x="-40" y="-40" width="200" height="200"><rect x="-40" y="-40" width="200" height="200" fill="#fff"/>'
          f'<path d="{"".join(s5.P(e) for e in E)}" fill="#000"/></mask>')
    ox,oy=12,14
    g=f'<g transform="translate({ox} {oy})"><path d="{s5.P(body)}" fill="{fill}" mask="url(#{mid})"/></g>'
    extra=''
    if expr=='sleepy': extra+='<path d="'+''.join(s5.P(z) for z in s5.zz(100,-2,1.7))+f'" fill="{fill}"/>'
    if expr=='talking':
        b,t,dots=s5.bubble(106,2,1.05)
        extra+=f'<path d="{s5.P(b)}{s5.P(t)}{"".join(s5.P(q) for q in dots)}" fill="{fill}" fill-rule="evenodd"/>'
    if prop: extra+=f'<rect x="{ox+W+6}" y="{oy+H-12}" width="12" height="12" fill="{fill}"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="-8 -12 136 136"><defs>{mask}</defs>{g}{extra}</svg>'
