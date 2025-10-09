(function(){
  if(document.body.getAttribute("data-page") !== "home") return;
  const scroller = document.getElementById("reviewScroller"); if(!scroller) return;
  // only fetch when empty
  if(scroller.children.length === 0){
    fetch('data/reviews.json').then(r=>r.json()).then(list=>{
      scroller.innerHTML = list.map(src=>`<div class="review-item"><img src="${src}" alt="Klant review"/></div>`).join('');
    });
  }
  const prev=document.getElementById("revPrev"), next=document.getElementById("revNext");
  if(prev) prev.addEventListener("click", ()=> scroller.scrollBy({left:-scroller.clientWidth*0.9, behavior:"smooth"}));
  if(next) next.addEventListener("click", ()=> scroller.scrollBy({left: scroller.clientWidth*0.9, behavior:"smooth"}));
})();