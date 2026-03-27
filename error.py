import sys
from math import gcd
from collections import defaultdict

def solve():
    data = sys.stdin.read().split()
    idx = 0
    N, C = int(data[idx]), int(data[idx+1]); idx += 2
    
    raw = []
    for _ in range(N):
        x, y = int(data[idx]), int(data[idx+1]); idx += 2
        raw.append((x, y))
    
    points = list(dict.fromkeys(raw))
    N = len(points)
    
    if N == 0: print(0); return
    if N == 1: print(1); return

    def line_key(p1, p2):
        x1,y1=p1; x2,y2=p2
        dx,dy = x2-x1, y2-y1
        g = gcd(abs(dx), abs(dy))
        dx//=g; dy//=g
        if dx<0 or (dx==0 and dy<0): dx,dy=-dx,-dy
        return (dx, dy, dy*x1 - dx*y1)

    # Build lines - but skip redundant pairs
    # For each point, find its line with every other point
    # Group points by line key efficiently
    line_sets = {}
    for i in range(N):
        for j in range(i+1, N):
            k = line_key(points[i], points[j])
            if k not in line_sets:
                line_sets[k] = set()
            line_sets[k].add(i)
            line_sets[k].add(j)

    all_lines = [frozenset(s) for s in line_sets.values()]
    
    # Sort lines by size descending - bigger lines tried first
    all_lines.sort(key=lambda s: -len(s))
    
    pt_to_lines = defaultdict(list)
    for li, lset in enumerate(all_lines):
        for p in lset:
            pt_to_lines[p].append(li)

    # Sort each point's lines by size descending
    for p in range(N):
        pt_to_lines[p].sort(key=lambda li: -len(all_lines[li]))

    all_pts = frozenset(range(N))
    
    # Precompute max line size covering each point
    max_line_size = {}
    for p in range(N):
        if pt_to_lines[p]:
            max_line_size[p] = len(all_lines[pt_to_lines[p][0]])
        else:
            max_line_size[p] = 1

    def can_cover_in(k):
        result = [False]
        
        def bt(covered, rem, uncovered_list):
            if result[0]: return
            if not uncovered_list:
                result[0] = True
                return
            if rem == 0: return

            # Most constrained point (fewest lines)
            # Also use it for pruning
            uncovered_set = set(uncovered_list)
            
            # Quick pruning: find upper bound on coverage
            # Sort uncovered by line count
            bp = min(uncovered_list, key=lambda p: len(pt_to_lines[p]))
            
            if len(pt_to_lines[bp]) == 0: return

            # Pruning: best possible = rem * largest available line
            # Find max gain possible from any line through bp
            best_possible = 0
            for li in pt_to_lines[bp]:
                gain = len(all_lines[li] - covered)
                if gain > best_possible:
                    best_possible = gain
            
            # Even if every remaining line covers best_possible new points,
            # can we cover all uncovered?
            if len(uncovered_list) > rem * best_possible:
                return

            for li in sorted(pt_to_lines[bp],
                             key=lambda li: -len(all_lines[li] - covered)):
                if result[0]: return
                new_covered = covered | all_lines[li]
                new_uncovered = [p for p in uncovered_list if p not in new_covered]
                bt(new_covered, rem - 1, new_uncovered)

        bt(frozenset(), k, list(range(N)))
        return result[0]

    for ans in range(1, N + 1):
        if can_cover_in(ans):
            print(ans)
            return
    print(N)

solve()