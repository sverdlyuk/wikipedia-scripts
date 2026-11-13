// Виправлення "червоних" посилань + список тих, що треба створити вручну.
// Встановлення: Special:МояСторінка/common.js → вставити → зберегти → оновити сторінку.
mw.loader.using(['mediawiki.api','mediawiki.util']).then(function () {
  $(function () {
    var $box = $('#wpTextbox1');
    if (!$box.length) return;
    var api = new mw.Api();

    function norm(t){ t=t.replace(/_/g,' ').trim(); return t ? t.charAt(0).toUpperCase()+t.slice(1) : t; }

    function extractLinks(text){
      var re=/\[\[\s*([^\[\]|#]+?)\s*(#[^\[\]|]*)?\s*(?:\|([^\[\]]*))?\]\]/g, m, map={};
      var skip=/^(Файл|File|Категорія|Category|Шаблон|Template):|^:/i;
      while((m=re.exec(text))){
        var tgt=norm(m[1]);
        if(tgt && !skip.test(tgt) && !(tgt in map)) map[tgt]=(m[3]||m[1]).trim();
      }
      return map;
    }
    function chunk(a,n){var o=[];for(var i=0;i<a.length;i+=n)o.push(a.slice(i,i+n));return o;}

    function findMissing(titles){
      var missing={}; titles.forEach(function(t){missing[t]=true;});
      var jobs=chunk(titles,50).map(function(batch){
        return api.get({action:'query',redirects:1,titles:batch.join('|')}).then(function(r){
          var q=r.query||{}, remap={};
          (q.normalized||[]).forEach(function(n){remap[n.from]=n.to;});
          (q.redirects||[]).forEach(function(rd){remap[rd.from]=rd.to;});
          var exist={};
          $.each(q.pages||{},function(_,p){ if(!('missing' in p)) exist[p.title]=true; });
          batch.forEach(function(o){ var res=remap[o]||o; res=remap[res]||res; if(exist[res]) delete missing[o]; });
        });
      });
      return $.when.apply($,jobs).then(function(){ return Object.keys(missing); });
    }

function resolveViaEnwiki(enTitles){
  var found={};
  var jobs=chunk(enTitles,50).map(function(batch){
    var url='https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*'
      +'&prop=langlinks&lllang=uk&lllimit=500&redirects=1'
      +'&titles='+encodeURIComponent(batch.join('|'));
    return fetch(url,{credentials:'omit'}).then(function(r){return r.json();}).then(function(d){
      var q=d.query||{}, remap={}, canon2uk={};
      (q.normalized||[]).forEach(function(n){remap[n.from]=n.to;});
      (q.redirects||[]).forEach(function(rd){remap[rd.from]=rd.to;});
      $.each(q.pages||{},function(_,p){
        if(p.langlinks && p.langlinks[0]) canon2uk[p.title]=p.langlinks[0]['*'];
      });
      batch.forEach(function(o){
        var c=remap[o]||o; c=remap[c]||c;      // original → (normalized) → (redirect) → канонічна
        if(canon2uk[c]) found[norm(o)]=canon2uk[c];  // ключ = ОРИГІНАЛЬНА назва, під яку робиш заміну
      });
    });
  });
  return $.when.apply($,jobs).then(function(){ return found; });
}

    function renderReport(fixes, unresolved){
      $('#rlr-report').remove();
      var $r=$('<div id="rlr-report" style="margin:6px 0;padding:8px;border:1px solid #c8ccd1;background:#f8f9fa;font-size:90%"></div>');
      if(fixes.length){
        $r.append('<b>Замінено ('+fixes.length+'):</b>');
        var $ul=$('<ul style="margin:4px 0 8px 1.5em"></ul>');
        fixes.forEach(function(f){ $ul.append($('<li>').text('[['+f[0]+']] → [['+f[1]+']]')); });
        $r.append($ul);
      }
      if(unresolved.length){
        $r.append('<b style="color:#b32424">Без українського відповідника — створити вручну ('+unresolved.length+'):</b>');
        var $ul2=$('<ul style="margin:4px 0 0 1.5em"></ul>');
        unresolved.sort().forEach(function(t){
          var $a=$('<a>').attr({href:mw.util.getUrl(t),target:'_blank'})
                         .css('color','#b32424').text(t);
          $ul2.append($('<li>').append($a));
        });
        $r.append($ul2);
      } else if(fixes.length){
        $r.append('<div style="color:#14866d">Усі червоні з відповідником опрацьовано ✔</div>');
      }
      $box.before($r);
    }

    function run(){
      var text=$box.val(), links=extractLinks(text), titles=Object.keys(links);
      $btn.prop('disabled',true).text('Перевіряю…');
      findMissing(titles).then(function(missing){
        if(!missing.length){ renderReport([],[]); alert('Червоних посилань не знайдено.'); return; }
        return resolveViaEnwiki(missing).then(function(found){
          var fixes=[], unresolved=[];
          missing.forEach(function(en){ if(found[en]) fixes.push([en, found[en]]); else unresolved.push(en); });

          if(fixes.length){
            var msg='Замінити ці '+fixes.length+' посилання?\n\n'
              + fixes.map(function(f){ return '[['+f[0]+']] → [['+f[1]+']]'; }).join('\n');
            if(confirm(msg)){                              // <-- твоє підтвердження
              var out=text;
              fixes.forEach(function(f){
                var en=f[0], uk=f[1];
                var re=new RegExp('\\[\\[\\s*'+en.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*(\\|[^\\[\\]]*)?\\]\\]','gi');
                out=out.replace(re,function(_,pipe){ return '[['+uk+(pipe||'')+']]'; });
              });
              $box.val(out);
            } else {
              fixes=[];                                    // відмовився — нічого не замінюємо
            }
          }
          renderReport(fixes, unresolved);                 // панель зі списками завжди
        });
      }).always(function(){ $btn.prop('disabled',false).text('🔧 Червоні → укр'); });
    }

    var $btn = $('<button type="button" style="margin:4px 0">🔧 Червоні → укр</button>').on('click', run);
    $box.before($btn);
  });
});
