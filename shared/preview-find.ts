/** DOM text offsets are UTF-16 offsets, including when a match crosses inline nodes. */
export function createPreviewRangeIndex(lengths:readonly number[]){
  const valid=lengths.every(size=>Number.isSafeInteger(size)&&size>=0),ends:number[]=[]
  let total=0
  if(valid)for(const size of lengths){total+=size;ends.push(total)}
  const boundary=(offset:number,exclusive:boolean)=>{let low=0,high=ends.length;while(low<high){const mid=(low+high)>>>1;if(exclusive?ends[mid]!<=offset:ends[mid]!<offset)low=mid+1;else high=mid}return {index:low,offset:offset-(ends[low-1]||0)}}
  return (from:number,to:number)=>{
    if(!valid||!Number.isSafeInteger(total)||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<=from||to>total)return null
    return {start:boundary(from,true),end:boundary(to,false)}
  }
}
export function previewRangeBoundaries(lengths:readonly number[],from:number,to:number){return createPreviewRangeIndex(lengths)(from,to)}
