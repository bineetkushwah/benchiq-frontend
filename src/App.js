/* eslint-disable */
import { useState, useEffect, useRef } from "react";

// ── CONFIG — replace with your Railway API URL after deployment ────────────
const API_BASE = "https://web-production-733b3.up.railway.app"; // TODO: replace after Railway deploy

const COURTS = [
  "Bombay High Court","Delhi High Court","Madras High Court",
  "Calcutta High Court","Supreme Court of India","Allahabad High Court",
  "Karnataka High Court","Gujarat High Court",
];
const CASE_TYPES = [
  "Quashing of FIR","Bail Application","Writ Petition","Anticipatory Bail",
  "Criminal Appeal","Civil Suit","Indirect Taxation","Matrimonial Dispute",
  "Property Dispute","Contempt of Court",
];
const SAMPLE_JUDGES = {
  "Bombay High Court": ["Justice Vibha Kankanwadi","Justice A.S. Chandurkar","Justice R.D. Dhanuka","Justice N.J. Jamadar"],
  "Delhi High Court": ["Justice Suresh Kumar Kait","Justice Prathiba M. Singh","Justice Rajiv Shakdher"],
  "Supreme Court of India": ["Justice Sanjiv Khanna","Justice B.R. Gavai","Justice Surya Kant"],
  "Madras High Court": ["Justice N. Sathish Kumar","Justice R. Mahadevan","Justice G.R. Swaminathan"],
  "Calcutta High Court": ["Justice T.S. Sivagnanam","Justice Harish Tandon"],
  "Allahabad High Court": ["Justice Manoj Kumar Gupta","Justice Saumitra Dayal Singh"],
  "Karnataka High Court": ["Justice Alok Aradhe","Justice S. Sunil Dutt Yadav"],
  "Gujarat High Court": ["Justice Sunita Agarwal","Justice N.V. Anjaria"],
};

// Aggregate raw n8n results into ranked advocates
function aggregateAdvocates(results) {
  const map = {};
  for (const r of results) {
    const adv = r.advocate_for_applicant || r.advocate || "Unknown";
    if (!adv || adv === "not mentioned" || adv === "Unknown") continue;
    if (!map[adv]) map[adv] = { name: adv, wins: 0, total: 0, cases: [] };
    map[adv].total += 1;
    if ((r.decision_in_favor_of || "").toLowerCase().includes("applicant") ||
        (r.decision_in_favor_of || "").toLowerCase().includes("petitioner")) {
      map[adv].wins += 1;
    }
    map[adv].cases.push({ title: r.judgment_title, url: r.case_url, date: r.date });
  }
  return Object.values(map)
    .map(a => ({ ...a, successRate: Math.round((a.wins / a.total) * 100) }))
    .sort((a, b) => b.wins - a.wins || b.successRate - a.successRate);
}

function AdvocateCard({ adv, rank }) {
  const colors = ["#FFD700","#C0C0C0","#CD7F32"];
  const c = colors[rank] || "#4A9EFF";
  return (
    <div style={{
      background:"rgba(255,255,255,0.04)", border:`1px solid rgba(255,255,255,0.1)`,
      borderLeft:`3px solid ${c}`, borderRadius:"12px", padding:"18px 20px",
      marginBottom:"10px", transition:"background 0.2s"
    }}
    onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.07)"}
    onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
          <span style={{
            background:c, color:rank<3?"#000":"#fff", borderRadius:"50%",
            width:"26px", height:"26px", display:"flex", alignItems:"center",
            justifyContent:"center", fontWeight:"800", fontSize:"12px", flexShrink:0
          }}>#{rank+1}</span>
          <div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:"16px",fontWeight:"700",color:"#F0ECE3"}}>{adv.name}</div>
            <div style={{color:"#8B9BAA",fontSize:"12px",marginTop:"2px"}}>{adv.wins} wins · {adv.total} cases analyzed</div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:"22px",fontWeight:"800",color:"#4ADE80"}}>{adv.successRate}%</div>
          <div style={{color:"#6B7A8D",fontSize:"11px"}}>success rate</div>
        </div>
      </div>
      <div style={{marginTop:"10px",marginLeft:"36px"}}>
        <div style={{height:"4px",background:"rgba(255,255,255,0.08)",borderRadius:"4px",overflow:"hidden"}}>
          <div style={{width:`${adv.successRate}%`,height:"100%",background:`linear-gradient(90deg,${c},${c}88)`,borderRadius:"4px",transition:"width 0.8s ease"}}/>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({court:"",judge:"",caseType:"",clientSituation:"",year:"2025"});
  const [jobId, setJobId] = useState(null);
  const [rawResults, setRawResults] = useState([]);
  const [streamStatus, setStreamStatus] = useState("");
  const [advocates, setAdvocates] = useState([]);
  const [legalAdvice, setLegalAdvice] = useState("");
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [jobStatus, setJobStatus] = useState("");
  const [analyzed, setAnalyzed] = useState(0);
  const eventSourceRef = useRef(null);

  const judges = SAMPLE_JUDGES[form.court] || [];

  // ── Start analysis job ────────────────────────────────────────────────
  const startAnalysis = async () => {
    setStep(2);
    setRawResults([]);
    setAnalyzed(0);
    setJobStatus("starting");
    try {
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          court: form.court,
          judge: form.judge,
          case_type: form.caseType,
          year: form.year,
          max_judgments: 40,
        }),
      });
      const data = await res.json();
      setJobId(data.job_id);
      setJobStatus("running");
      startSSEStream(data.job_id);
    } catch (e) {
      setJobStatus("error");
      setStreamStatus("Could not connect to backend. Is Railway deployed?");
    }
  };

  // ── SSE Stream: listen for live results from backend ─────────────────
  const startSSEStream = (jid) => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    const es = new EventSource(`${API_BASE}/api/stream/${jid}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      const result = JSON.parse(e.data);
      setRawResults(prev => {
        const updated = [...prev, result];
        setAdvocates(aggregateAdvocates(updated));
        setAnalyzed(updated.length);
        return updated;
      });
    };

    es.addEventListener("status", (e) => {
      const { status, total } = JSON.parse(e.data);
      setJobStatus(status);
      setStreamStatus(`${total} judgments analyzed`);
    });

    es.addEventListener("done", () => {
      es.close();
      setJobStatus("complete");
      setStep(3);
    });

    es.onerror = () => {
      setStreamStatus("Stream error — check Railway logs");
    };
  };

  // ── Get AI Legal Advice ────────────────────────────────────────────────
  const getAdvice = async () => {
    setStep(4);
    setAdviceLoading(true);
    setLegalAdvice("");
    try {
      const res = await fetch(`${API_BASE}/api/advice`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          court: form.court,
          judge: form.judge,
          case_type: form.caseType,
          client_situation: form.clientSituation || `Client is facing ${form.caseType} proceedings`,
          top_advocate: advocates[0]?.name || "TBD",
          top_advocate_success_rate: advocates[0]?.successRate || 0,
        }),
      });
      const data = await res.json();
      setLegalAdvice(data.advice || "No advice returned.");
    } catch (e) {
      setLegalAdvice("Error connecting to API. Please check Railway deployment.");
    }
    setAdviceLoading(false);
  };

  const reset = () => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    setStep(1); setForm({court:"",judge:"",caseType:"",clientSituation:"",year:"2025"});
    setRawResults([]); setAdvocates([]); setLegalAdvice(""); setJobId(null); setAnalyzed(0);
  };

  return (
    <div style={{minHeight:"100vh",background:"#0D1117",fontFamily:"'Inter',sans-serif",color:"#F0ECE3"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Inter:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:5px;}::-webkit-scrollbar-track{background:#0D1117;}::-webkit-scrollbar-thumb{background:#2A3441;border-radius:3px;}
        select,textarea{appearance:none;outline:none;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.45;}}
        @keyframes blink{0%,100%{opacity:1;}50%{opacity:0;}}
        .fade-up{animation:fadeUp 0.45s ease forwards;}
      `}</style>

      {/* Header */}
      <div style={{borderBottom:"1px solid rgba(255,255,255,0.07)",padding:"18px 32px",display:"flex",alignItems:"center",gap:"14px",background:"rgba(255,255,255,0.02)"}}>
        <div style={{width:"36px",height:"36px",borderRadius:"10px",background:"linear-gradient(135deg,#1E3A5F,#4A9EFF)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"17px"}}>⚖️</div>
        <div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:"19px",fontWeight:"800"}}>BenchIQ</div>
          <div style={{color:"#6B7A8D",fontSize:"11px"}}>Real-Time Legal Intelligence · India · n8n + Railway</div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:"6px"}}>
          {[1,2,3,4].map(s=>(
            <div key={s} style={{width:"26px",height:"4px",borderRadius:"2px",background:step>=s?"#4A9EFF":"rgba(255,255,255,0.1)",transition:"background 0.3s"}}/>
          ))}
        </div>
      </div>

      <div style={{maxWidth:"760px",margin:"0 auto",padding:"38px 22px"}}>

        {/* STEP 1 */}
        {step===1&&(
          <div className="fade-up">
            <div style={{marginBottom:"28px"}}>
              <div style={{color:"#4A9EFF",fontSize:"12px",fontWeight:"600",marginBottom:"8px",letterSpacing:"0.08em",textTransform:"uppercase"}}>Step 1 of 4 · Client Intake</div>
              <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:"30px",fontWeight:"800",lineHeight:1.2,marginBottom:"8px"}}>Litigation Intelligence Search</h1>
              <p style={{color:"#8B9BAA",fontSize:"14px",lineHeight:1.6}}>Enter your client's case details. We'll scrape Indian Kanoon in real-time to find the best advocate for the specific bench.</p>
            </div>
            <div style={{display:"grid",gap:"18px"}}>
              {/* Court */}
              <div>
                <label style={{display:"block",fontSize:"12px",fontWeight:"600",color:"#8B9BAA",marginBottom:"7px",textTransform:"uppercase",letterSpacing:"0.06em"}}>Court</label>
                <select value={form.court} onChange={e=>setForm({...form,court:e.target.value,judge:""})} style={{width:"100%",padding:"13px 15px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"10px",color:form.court?"#F0ECE3":"#6B7A8D",fontSize:"14px",cursor:"pointer"}}>
                  <option value="">Select court...</option>
                  {COURTS.map(c=><option key={c} value={c} style={{background:"#1A2332"}}>{c}</option>)}
                </select>
              </div>
              {/* Year */}
              <div>
                <label style={{display:"block",fontSize:"12px",fontWeight:"600",color:"#8B9BAA",marginBottom:"7px",textTransform:"uppercase",letterSpacing:"0.06em"}}>Year</label>
                <div style={{display:"flex",gap:"8px"}}>
                  {["2023","2024","2025"].map(y=>(
                    <button key={y} onClick={()=>setForm({...form,year:y})} style={{flex:1,padding:"11px",borderRadius:"8px",cursor:"pointer",border:`1px solid ${form.year===y?"#4A9EFF":"rgba(255,255,255,0.08)"}`,background:form.year===y?"rgba(74,158,255,0.12)":"rgba(255,255,255,0.03)",color:form.year===y?"#4A9EFF":"#8B9BAA",fontWeight:form.year===y?"700":"400",fontSize:"14px"}}>
                      {y}
                    </button>
                  ))}
                </div>
              </div>
              {/* Judge */}
              <div>
                <label style={{display:"block",fontSize:"12px",fontWeight:"600",color:"#8B9BAA",marginBottom:"7px",textTransform:"uppercase",letterSpacing:"0.06em"}}>Judge / Bench</label>
                <select value={form.judge} onChange={e=>setForm({...form,judge:e.target.value})} disabled={!form.court} style={{width:"100%",padding:"13px 15px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"10px",color:form.judge?"#F0ECE3":"#6B7A8D",fontSize:"14px",cursor:form.court?"pointer":"not-allowed",opacity:form.court?1:0.5}}>
                  <option value="">Select judge...</option>
                  {judges.map(j=><option key={j} value={j} style={{background:"#1A2332"}}>{j}</option>)}
                </select>
              </div>
              {/* Case Type */}
              <div>
                <label style={{display:"block",fontSize:"12px",fontWeight:"600",color:"#8B9BAA",marginBottom:"7px",textTransform:"uppercase",letterSpacing:"0.06em"}}>Case Type</label>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px"}}>
                  {CASE_TYPES.map(ct=>(
                    <button key={ct} onClick={()=>setForm({...form,caseType:ct})} style={{padding:"11px 13px",borderRadius:"8px",cursor:"pointer",border:`1px solid ${form.caseType===ct?"#4A9EFF":"rgba(255,255,255,0.08)"}`,background:form.caseType===ct?"rgba(74,158,255,0.12)":"rgba(255,255,255,0.03)",color:form.caseType===ct?"#4A9EFF":"#8B9BAA",fontSize:"13px",fontWeight:form.caseType===ct?"600":"400",textAlign:"left"}}>
                      {ct}
                    </button>
                  ))}
                </div>
              </div>
              {/* Situation */}
              <div>
                <label style={{display:"block",fontSize:"12px",fontWeight:"600",color:"#8B9BAA",marginBottom:"7px",textTransform:"uppercase",letterSpacing:"0.06em"}}>Client Situation <span style={{color:"#4B5563",fontWeight:"400",textTransform:"none"}}>(optional)</span></label>
                <textarea value={form.clientSituation} onChange={e=>setForm({...form,clientSituation:e.target.value})} placeholder="e.g. FIR under IPC 420 filed against my client, a businessman. Case relates to alleged cheating in a property deal..." rows={3} style={{width:"100%",padding:"13px 15px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"10px",color:"#F0ECE3",fontSize:"13px",lineHeight:1.6,resize:"vertical"}}/>
              </div>
              <button onClick={startAnalysis} disabled={!form.court||!form.judge||!form.caseType} style={{padding:"15px 26px",background:(!form.court||!form.judge||!form.caseType)?"rgba(74,158,255,0.2)":"linear-gradient(135deg,#1E3A5F,#4A9EFF)",border:"none",borderRadius:"12px",color:"#fff",fontSize:"15px",fontWeight:"700",cursor:(!form.court||!form.judge||!form.caseType)?"not-allowed":"pointer",opacity:(!form.court||!form.judge||!form.caseType)?0.5:1,transition:"all 0.2s"}}>
                🔍 Start Real-Time Analysis →
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Live Streaming */}
        {step===2&&(
          <div className="fade-up">
            <div style={{marginBottom:"28px"}}>
              <div style={{color:"#4A9EFF",fontSize:"12px",fontWeight:"600",marginBottom:"8px",letterSpacing:"0.08em",textTransform:"uppercase"}}>Step 2 of 4 · Live Analysis</div>
              <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"26px",fontWeight:"800",marginBottom:"6px"}}>Scraping Indian Kanoon...</h2>
              <p style={{color:"#8B9BAA",fontSize:"13px"}}>
                <strong style={{color:"#F0ECE3"}}>{form.caseType}</strong> · <strong style={{color:"#F0ECE3"}}>{form.judge}</strong> · {form.court}
              </p>
            </div>

            {/* Live Pipeline Status */}
            <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"14px",padding:"20px 22px",marginBottom:"22px"}}>
              {[
                {label:"Python scraper hits Indian Kanoon", done: analyzed>0},
                {label:`Judgments sent to n8n webhook`, done: analyzed>0, count: analyzed},
                {label:"Claude extracts metadata per judgment", done: analyzed>0},
                {label:"Results streamed back to frontend", done: advocates.length>0},
              ].map((s,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:i<3?"12px":"0"}}>
                  <div style={{
                    width:"20px",height:"20px",borderRadius:"50%",flexShrink:0,
                    border:`2px solid ${s.done?"#4ADE80":"rgba(255,255,255,0.15)"}`,
                    background:s.done?"rgba(74,222,128,0.15)":"transparent",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px"
                  }}>{s.done?"✓":""}</div>
                  <span style={{color:s.done?"#D4D8DC":"#6B7A8D",fontSize:"14px"}}>
                    {s.label} {s.count!==undefined&&s.done?<span style={{color:"#4A9EFF",fontWeight:"700"}}>({s.count})</span>:""}
                  </span>
                  {!s.done&&<span style={{width:"6px",height:"6px",borderRadius:"50%",background:"#4A9EFF",animation:"blink 1s ease infinite",flexShrink:0}}/>}
                </div>
              ))}
            </div>

            {/* Live Advocate Preview */}
            {advocates.length>0&&(
              <div style={{marginBottom:"20px"}}>
                <div style={{fontSize:"13px",color:"#8B9BAA",marginBottom:"10px"}}>
                  📊 Live results — {analyzed} judgments analyzed so far
                </div>
                {advocates.slice(0,3).map((a,i)=><AdvocateCard key={a.name} adv={a} rank={i}/>)}
                {advocates.length>3&&<div style={{color:"#6B7A8D",fontSize:"13px",padding:"8px 0"}}>+ {advocates.length-3} more advocates...</div>}
              </div>
            )}

            {advocates.length===0&&(
              <div style={{textAlign:"center",padding:"30px 0"}}>
                <div style={{width:"48px",height:"48px",margin:"0 auto 16px",border:"3px solid rgba(74,158,255,0.2)",borderTop:"3px solid #4A9EFF",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
                <div style={{fontSize:"14px",fontWeight:"600",animation:"pulse 1.5s ease infinite"}}>Waiting for first results...</div>
                <div style={{color:"#6B7A8D",fontSize:"12px",marginTop:"6px"}}>{streamStatus||"Connecting to backend..."}</div>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: Results */}
        {step===3&&(
          <div className="fade-up">
            <div style={{marginBottom:"24px"}}>
              <div style={{color:"#4ADE80",fontSize:"12px",fontWeight:"600",marginBottom:"8px",letterSpacing:"0.08em",textTransform:"uppercase"}}>Step 3 of 4 · Results</div>
              <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"26px",fontWeight:"800",marginBottom:"6px"}}>Top Advocates Before {form.judge}</h2>
              <p style={{color:"#8B9BAA",fontSize:"13px"}}>{form.caseType} · {form.court} · {analyzed} judgments analyzed</p>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"10px",marginBottom:"20px"}}>
              {[
                {label:"Judgments Analyzed",value:analyzed,icon:"📄"},
                {label:"Advocates Found",value:advocates.length,icon:"👨‍⚖️"},
                {label:"Top Success Rate",value:(advocates[0]?.successRate||0)+"%",icon:"🏆"},
              ].map(s=>(
                <div key={s.label} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"12px",padding:"14px",textAlign:"center"}}>
                  <div style={{fontSize:"20px",marginBottom:"3px"}}>{s.icon}</div>
                  <div style={{fontFamily:"'Playfair Display',serif",fontSize:"20px",fontWeight:"800",color:"#4A9EFF"}}>{s.value}</div>
                  <div style={{color:"#6B7A8D",fontSize:"11px",marginTop:"2px"}}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{marginBottom:"20px"}}>
              {advocates.map((a,i)=><AdvocateCard key={a.name} adv={a} rank={i}/>)}
            </div>
            {advocates[0]&&(
              <div style={{background:"linear-gradient(135deg,rgba(74,158,255,0.1),rgba(74,222,128,0.05))",border:"1px solid rgba(74,158,255,0.3)",borderRadius:"14px",padding:"18px 20px",marginBottom:"20px"}}>
                <div style={{fontWeight:"700",fontSize:"14px",marginBottom:"5px"}}>✅ Recommended: {advocates[0].name}</div>
                <div style={{color:"#8B9BAA",fontSize:"13px",lineHeight:1.6}}>
                  With <strong style={{color:"#4ADE80"}}>{advocates[0].successRate}% success rate</strong> ({advocates[0].wins}/{advocates[0].total} cases) before {form.judge}, this advocate gives your client the best odds of a favorable {form.caseType} outcome.
                </div>
              </div>
            )}
            <div style={{display:"flex",gap:"10px"}}>
              <button onClick={getAdvice} style={{flex:1,padding:"15px",background:"linear-gradient(135deg,#1a3a1a,#4ADE80)",border:"none",borderRadius:"12px",color:"#fff",fontSize:"14px",fontWeight:"700",cursor:"pointer"}}>
                🤖 Get AI Legal Advice for Client →
              </button>
              <button onClick={reset} style={{padding:"15px 18px",background:"transparent",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"12px",color:"#8B9BAA",fontSize:"13px",cursor:"pointer"}}>
                ↩ New
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: AI Legal Advice */}
        {step===4&&(
          <div className="fade-up">
            <div style={{marginBottom:"24px"}}>
              <div style={{color:"#4ADE80",fontSize:"12px",fontWeight:"600",marginBottom:"8px",letterSpacing:"0.08em",textTransform:"uppercase"}}>Step 4 of 4 · AI Legal Advice</div>
              <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"26px",fontWeight:"800",marginBottom:"6px"}}>Legal Strategy for Your Client</h2>
              <p style={{color:"#8B9BAA",fontSize:"13px"}}>{form.caseType} · {form.court} · Powered by Claude</p>
            </div>
            <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"12px",padding:"14px 18px",marginBottom:"18px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
              {[["Court",form.court],["Judge",form.judge],["Case Type",form.caseType],["Top Advocate",`${advocates[0]?.name} (${advocates[0]?.successRate}%)`]].map(([k,v])=>(
                <div key={k}><div style={{color:"#6B7A8D",fontSize:"11px",textTransform:"uppercase",letterSpacing:"0.05em"}}>{k}</div><div style={{fontSize:"13px",fontWeight:"600",marginTop:"2px"}}>{v}</div></div>
              ))}
            </div>
            {adviceLoading?(
              <div style={{textAlign:"center",padding:"50px 0"}}>
                <div style={{width:"52px",height:"52px",margin:"0 auto 18px",border:"3px solid rgba(74,222,128,0.2)",borderTop:"3px solid #4ADE80",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
                <div style={{fontSize:"14px",fontWeight:"600",animation:"pulse 1.5s ease infinite"}}>Claude is drafting legal strategy...</div>
              </div>
            ):(
              <div>
                <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(74,222,128,0.2)",borderRadius:"14px",padding:"22px 24px",marginBottom:"16px",lineHeight:1.8,fontSize:"14px",color:"#D4D8DC",whiteSpace:"pre-wrap"}}>
                  {legalAdvice}
                </div>
                <div style={{background:"rgba(255,200,0,0.06)",border:"1px solid rgba(255,200,0,0.2)",borderRadius:"10px",padding:"12px 16px",marginBottom:"18px"}}>
                  <span style={{color:"#FFC107",fontSize:"12px"}}>⚠️ <strong>Disclaimer:</strong> AI-generated advice for informational purposes only. Not a substitute for formal legal consultation with a qualified advocate.</span>
                </div>
                <div style={{display:"flex",gap:"10px"}}>
                  <button onClick={()=>setStep(3)} style={{flex:1,padding:"13px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"12px",color:"#8B9BAA",fontSize:"13px",cursor:"pointer"}}>← Back to Rankings</button>
                  <button onClick={reset} style={{flex:1,padding:"13px",background:"linear-gradient(135deg,#1E3A5F,#4A9EFF)",border:"none",borderRadius:"12px",color:"#fff",fontSize:"14px",fontWeight:"700",cursor:"pointer"}}>+ New Client</button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
