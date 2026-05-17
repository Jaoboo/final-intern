// app/report/PptxExporter.tsx
'use client'

import { useEffect } from 'react'
import { STATUS_OPTIONS } from '../shared'

interface ReportRow {
  id: string
  modeName: string
  assumptionDetail: string
  assumptionPicture: string
  actionDetail: string
  actionPicture: string
  dueDateStart: string
  dueDateEnd: string
  pic: string
  progress: number
  status: string
}

function getMergeMap(rows: ReportRow[]): Map<number, number> {
  const map = new Map<number, number>()
  let i = 0
  while (i < rows.length) {
    const mode = rows[i].modeName?.trim()
    if (!mode) { map.set(i, 1); i++ }
    else {
      let j = i + 1
      while (j < rows.length && rows[j].modeName?.trim() === mode) j++
      map.set(i, j - i); i = j
    }
  }
  return map
}

interface Props {
  rows: ReportRow[]
  todayStr: string
  onDone: () => void
}

export default function PptxExporter({ rows, todayStr, onDone }: Props) {
  useEffect(() => {
    const run = async () => {
      const { default: PptxGenJS } = await import('pptxgenjs')
      const prs = new PptxGenJS()
      prs.layout = 'LAYOUT_WIDE'

      const cover = prs.addSlide()
      cover.background = { color: 'FFFFFF' }
      cover.addText('Report', { x:1, y:2.5, w:11, h:1, fontSize:34, bold:true, color:'000000', align:'center' })
      cover.addText(todayStr,  { x:1, y:3.7, w:11, h:0.5, fontSize:14, color:'000000', align:'center' })

      const SW=13.33, HDR_H=0.5, TBL_X=0.2, TBL_Y=HDR_H+0.25, TBL_W=SW-0.4
      const ROW_H=1.6, HDR_ROW1_H=0.35, HDR_ROW2_H=0.35, HDR_ROWS_H=HDR_ROW1_H+HDR_ROW2_H
      const BLACK='000000', HDR_BG='F0F0F0', ROW_EVEN='FFFFFF', ROW_ODD='F8F8F8', MODE_BG='E8E8E8'
      const BORDER = { type: 'solid' as const, color: '000000', pt: 0.5 }
      const COL_PCT = [0.07,0.21,0.07,0.21,0.07,0.08,0.08,0.06,0.08,0.07]
      const COL_W = COL_PCT.map(p => +(p * TBL_W).toFixed(3))

      const statusColor = (label: string) =>
        STATUS_OPTIONS.find(s => s.label === label)?.color?.replace('#','') ?? '888888'

      const renderPizzaPng = (progress: number, sizePx = 96): string => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = sizePx
        const ctx = canvas.getContext('2d')!
        const cx = sizePx/2, cy = sizePx/2, r = sizePx/2 - 2
        const filledSlices = Math.round(progress / 25)
        const toRad = (p: number) => (p/100) * 2 * Math.PI - Math.PI/2
        const slices: [number,number][] = [[0,25],[25,50],[50,75],[75,100]]
        slices.forEach(([s,e], i) => {
          ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,toRad(s),toRad(e)); ctx.closePath()
          ctx.fillStyle = i < filledSlices ? '#1462FF' : '#E8ECF0'; ctx.fill()
        })
        slices.forEach(([s]) => {
          ctx.beginPath(); ctx.moveTo(cx,cy)
          ctx.lineTo(cx + r*Math.cos(toRad(s)), cy + r*Math.sin(toRad(s)))
          ctx.strokeStyle = '#fff'; ctx.lineWidth = sizePx/20; ctx.stroke()
        })
        ctx.beginPath(); ctx.arc(cx,cy,r,0,2*Math.PI)
        ctx.strokeStyle = '#9CA3AF'; ctx.lineWidth = 1.5; ctx.stroke()
        return canvas.toDataURL('image/png').split(',')[1]
      }

      const availH = 7.5 - TBL_Y - 0.1
      const rowsPerSlide = Math.max(1, Math.floor((availH - HDR_ROWS_H) / ROW_H))
      const totalSlides = Math.ceil(rows.length / rowsPerSlide)
      const cellBase = { border: BORDER, valign: 'middle' as const, align: 'center' as const, fontSize: 8, fontFace: 'Sarabun', color: BLACK }
      const hdrCell = { ...cellBase, bold: true, fontSize: 12, color: BLACK, fill: { color: HDR_BG } }

      for (let s = 0; s < totalSlides; s++) {
        const slide = prs.addSlide()
        slide.addShape(prs.ShapeType.rect, { x:0, y:0, w:SW, h:HDR_H, fill:{ color:'DDDDDD' } })
        slide.addText('Report',  { x:0.3, y:0, w:8,       h:HDR_H, fontSize:13, bold:true, color:BLACK, valign:'middle' })
        slide.addText(todayStr,  { x:8,   y:0, w:SW-8.3,  h:HDR_H, fontSize:10, color:BLACK, align:'right', valign:'middle' })

        const tableRows: any[][] = []
        tableRows.push([
          { text:'Mode',       options:{ ...hdrCell, rowspan:2, w:COL_W[0] } },
          { text:'Assumption', options:{ ...hdrCell, colspan:2 } },
          { text:'Action',     options:{ ...hdrCell, colspan:2 } },
          { text:'Due Date',   options:{ ...hdrCell, rowspan:2 } },
          { text:'PIC',        options:{ ...hdrCell, rowspan:2 } },
          { text:'Progress',   options:{ ...hdrCell, rowspan:2 } },
          { text:'Status',     options:{ ...hdrCell, rowspan:2 } },
        ])
        tableRows.push([
          { text:'Detail',  options:{ ...hdrCell, fontSize:12, color:BLACK } },
          { text:'Picture', options:{ ...hdrCell, fontSize:12, color:BLACK } },
          { text:'Detail',  options:{ ...hdrCell, fontSize:12, color:BLACK } },
          { text:'Picture', options:{ ...hdrCell, fontSize:12, color:BLACK } },
        ])

        const sliceRows = rows.slice(s*rowsPerSlide, (s+1)*rowsPerSlide)
        const globalOffset = s * rowsPerSlide
        const mergeMap = getMergeMap(sliceRows)

        sliceRows.forEach((row, localRi) => {
          const ri = globalOffset + localRi
          const bg = ri % 2 === 0 ? ROW_EVEN : ROW_ODD
          const isMerge = mergeMap.has(localRi)
          const span = mergeMap.get(localRi) ?? 1
          const hasMode = !!(row.modeName?.trim())
          const dataCell = { ...cellBase, fill: { color: bg } }
          const tblRow: any[] = []

          if (isMerge) tblRow.push({ text: row.modeName||'', options:{ ...dataCell, rowspan:span, bold:true, color:BLACK, fill:{ color: hasMode ? MODE_BG : 'FAFAFA' } } })
          tblRow.push({ text: row.assumptionDetail||'—', options:{ ...dataCell, align:'left', fontSize:8, color:BLACK } })
          tblRow.push({ text: '', options:{ ...dataCell, color:BLACK } })
          tblRow.push({ text: row.actionDetail||'—',    options:{ ...dataCell, align:'left', fontSize:8, color:BLACK } })
          tblRow.push({ text: '', options:{ ...dataCell, color:BLACK } })
          tblRow.push({ text: [row.dueDateStart,row.dueDateEnd].filter(Boolean).join('\n–\n')||'—', options:{ ...dataCell, fontSize:8, color:BLACK } })
          tblRow.push({ text: row.pic||'—',   options:{ ...dataCell, fontSize:8, color:BLACK } })
          tblRow.push({ text: '',             options:{ ...dataCell, color:BLACK } })
          tblRow.push({ text: row.status,     options:{ ...dataCell, bold:true, color:BLACK, fontSize:8 } })
          tableRows.push(tblRow)
        })

        const rowHArr = [HDR_ROW1_H, HDR_ROW2_H, ...sliceRows.map(() => ROW_H)]
        slide.addTable(tableRows, { x:TBL_X, y:TBL_Y, w:TBL_W, rowH:rowHArr, border:BORDER, fontFace:'Sarabun', fontSize:10, colW:COL_W })

        const getColX = (ci: number) => TBL_X + COL_W.slice(0,ci).reduce((a,b) => a+b, 0)
        const getRowY = (ri: number) => TBL_Y + HDR_ROWS_H + ri * ROW_H
        const IMG_PAD = 0.08
        const getImgDims = (src: string): Promise<{w:number,h:number}> => new Promise(res => {
          const img = new Image(); img.onload = () => res({w:img.naturalWidth,h:img.naturalHeight}); img.onerror = () => res({w:1,h:1}); img.src = src
        })
        const fitInCell = (natW:number,natH:number,cellX:number,cellY:number,cellW:number,cellH:number) => {
          const maxW=cellW-IMG_PAD*2, maxH=cellH-IMG_PAD*2
          const scale=Math.min(maxW/natW, maxH/natH)
          return { x:cellX+IMG_PAD+(maxW-natW*scale)/2, y:cellY+IMG_PAD+(maxH-natH*scale)/2, w:natW*scale, h:natH*scale }
        }

        await Promise.all(sliceRows.map(async (row, localRi) => {
          const ry = getRowY(localRi)
          const pngB64 = renderPizzaPng(row.progress)
          const pgX=getColX(7), pgW=COL_W[7], R=Math.min(pgW,ROW_H)*0.26
          slide.addImage({ data:`image/png;base64,${pngB64}`, x:pgX+pgW/2-R, y:ry+ROW_H*0.38-R, w:R*2, h:R*2 })
          slide.addText(`${row.progress}%`, { x:pgX, y:ry+ROW_H*0.68, w:pgW, h:0.25, fontSize:7, bold:true, color:BLACK, align:'center', fontFace:'Sarabun' })

          if (row.assumptionPicture) {
            const mm = row.assumptionPicture.match(/^data:(image\/(\w+));base64,/)
            if (mm) try { const d=await getImgDims(row.assumptionPicture); const p=fitInCell(d.w,d.h,getColX(2)-0.6,ry,COL_W[2],ROW_H); slide.addImage({data:`image/${mm[2]};base64,${row.assumptionPicture.split(',')[1]}`,x:p.x,y:p.y,w:p.w,h:p.h}) } catch {}
          }
          if (row.actionPicture) {
            const mm = row.actionPicture.match(/^data:(image\/(\w+));base64,/)
            if (mm) try { const d=await getImgDims(row.actionPicture); const p=fitInCell(d.w,d.h,getColX(4)-1.2,ry,COL_W[4],ROW_H); slide.addImage({data:`image/${mm[2]};base64,${row.actionPicture.split(',')[1]}`,x:p.x,y:p.y,w:p.w,h:p.h}) } catch {}
          }
        }))

        if (totalSlides > 1) slide.addText(`${s+1} / ${totalSlides}`, { x:SW-1.2, y:7.3, w:1, h:0.2, fontSize:8, color:'BBBBBB', align:'right' })
      }

      await prs.writeFile({ fileName: `defect-report-${new Date().toISOString().slice(0,10)}.pptx` })
      onDone()
    }
    run().catch(console.error)
  }, [])

  return null
}