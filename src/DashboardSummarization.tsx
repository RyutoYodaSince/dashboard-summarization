import React, { useCallback, useContext, useEffect, useState } from 'react'
import { ExtensionContext } from '@looker/extension-sdk-react'
import { Filters } from '@looker/extension-sdk'
import { BardLogo, LandingPage } from './components/LandingPage'
import { socket } from './socket'
import Markdown from 'react-markdown'
import useWorkspaceOauth from './hooks/useWorkspaceOauth'
import { SummaryDataContext } from './contexts/SummaryDataContext'
import useSlackOauth from './hooks/useSlackOauth'

interface DashboardMetadata {
  dashboardFilters: Filters | undefined,
  dashboardId: string | undefined,
  queries: {
    id: any;
    fields: any;
    view: any;
    model: any;
    dynamic_fields?: any;
  }[],
  indexedFilters: {
    [key: string]: {
      dimension: string,
      explore: string,
      model: string
    }
  }
}

/**
 * A simple component that uses the Looker SDK through the extension sdk to display a customized hello message.
 */
export const DashboardSummarization: React.FC = () => {
  const { extensionSDK, tileHostData, core40SDK} = useContext(ExtensionContext)
  const { dashboardFilters, dashboardId } = tileHostData
  const [dashboardMetadata, setDashboardMetadata] = useState<DashboardMetadata>()
  const [loadingDashboardMetadata, setLoadingDashboardMetadata] = useState<boolean>(false)
  const [isConnected, setIsConnected] = useState(socket.connected);
  const { data, setData, formattedData, setFormattedData, info, setInfo, message, setMessage } = useContext(SummaryDataContext)
  const [loading, setLoading] = useState(false)
  const workspaceOauth = useWorkspaceOauth()
  const slackOauth = useSlackOauth()

  useEffect(() => {
    function onConnect(value) {
      console.log("Connected!!", value)
      setIsConnected(true);
    }

    function onDisconnect(value) {
      console.log("Disconnected: ", value)
      setIsConnected(false);
    }

    function onFooEvent(value) {
      // console.log(value.toString())
      // need this conditional to make sure that headers aren't included in the li elements generated
      setData(previous => value.substring(0,2).includes("#") ? [...previous, '\n', value] : [...previous, value]);
    }

    function onComplete(event:string) {
      console.log(event)
      setFormattedData(event.replace('```json','').replaceAll('```','').trim())
      setLoading(false)
    }

    socket.connect()

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('my broadcast event', onFooEvent);
    socket.on('complete', onComplete)

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('my broadcast event', onFooEvent);
      socket.off('complete', onComplete);
    };
  }, [])

  const fetchQueryMetadata = useCallback(async () => {
    if(dashboardId) {
      setLoadingDashboardMetadata(true)
      setMessage("Loading Dashboard Metadata")
      const {dashboard_filters} = await core40SDK.ok(core40SDK.dashboard(dashboardId,'dashboard_filters'))
      
      const indexedFilters = {}
      dashboard_filters!.forEach((filter) => {
        const { explore, model, dimension} = filter
        indexedFilters[filter.name] = {
            ... {
              explore, model, dimension
            }
          }
      })
      
      const queries = await core40SDK.ok(core40SDK.dashboard_dashboard_elements(
        dashboardId, 'query,result_maker'))
        .then(
          (res) => {
            const queries = res
              // query checks looker query, result maker checks custom fields
              .filter((d) => d.query !== null || d.result_maker !== null)
              .map((data) => {
                if(data.query !== null) {
                  const {id, fields, view, model} = data.query
                  return {id, fields, view, model}
                } else {
                  const {id, fields, dynamic_fields, view, model } = data.result_maker!.query
                  return { id, fields, dynamic_fields, view, model }
                }
              })
            return queries
          }
        ).finally(() => {
          setLoadingDashboardMetadata(false)
          setMessage("Loaded Dashboard Metadata. Click 'Summarize Dashboard' to Generate report summary.")
          
        })
        if (!loadingDashboardMetadata) {
          await extensionSDK.localStorageSetItem(`${dashboardId}:${JSON.stringify(dashboardFilters)}`,JSON.stringify({ dashboardFilters, dashboardId, queries, indexedFilters}))
          setDashboardMetadata({ dashboardFilters, dashboardId, queries, indexedFilters})
        }
    }
  },[dashboardId])

  useEffect(() => {
    if(message && message.includes('Loaded Dashboard Metadata') || message.includes("Google Chat") || message.includes("Slack")){
      setTimeout(() => {
        setInfo(false)
      },1000)
    }
  },[message])


  useEffect(() => {
    async function fetchCachedMetadata() {
      return await extensionSDK.localStorageGetItem(`${tileHostData.dashboardId}:${JSON.stringify(tileHostData.dashboardFilters)}`)
    }
    fetchCachedMetadata().then((cachedMetadata) => {
      if (cachedMetadata !== null) {
       setLoadingDashboardMetadata(false)
       setMessage("Loaded Dashboard Metadata from cache. Click 'Summarize Dashboard' to Generate report summary.")
       setDashboardMetadata(JSON.parse(cachedMetadata || '{}'))
      } else if (tileHostData.dashboardRunState !== 'UNKNOWN') {
        fetchQueryMetadata()
      }
    })
  },[fetchQueryMetadata])

  return (
    <div style={{width:'100%', height:'100%'}}>
      {message ? 
        <div style={{
          position:'absolute',
          zIndex:1,
          top:info ? document.documentElement.scrollTop || document.body.scrollTop : -100,
          left:0,
          marginBottom:'1rem',
          width:'100%',
          padding:'0.8rem',
          fontSize:'0.8rem',
          color: 'rgb(0,8,2,0.8)',
          alignContent:'center',
          backgroundColor:'rgb(255, 100, 100,0.2)'
        }}>{message}
        </div>
      :
        <></>
      }
      <div className="layout" style={{boxShadow:'0px',paddingBottom:'1.2rem',marginBottom:'2rem'}}>
        <span style={{fontSize:'0.9rem',opacity:'0.8'}}>Summarize your Dashboard Queries</span>
        <button className='button' disabled={loading || !socket.connected} onClick={() => {
          setLoading(true)
          socket.emit("my event", JSON.stringify(dashboardMetadata))
        }}>Generate <img  style={{opacity: loading ? 0.2 : 1}}src="https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/summarize_auto/default/20px.svg"/></button>
      </div>
      <div className="layout" style={{boxShadow:'0px',opacity: !loading ? 1 : 0.2}}>
        <span style={{fontSize:'0.9rem',opacity:'0.8', width: '60%'}}>Export your Insights</span>
        <button disabled={loading} onClick={workspaceOauth} className='button' style={{borderRadius:'50%',padding:'0.5rem'}}>
          <img height={20} width={20} src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Google_Chat_icon_%282020%29.svg/1024px-Google_Chat_icon_%282020%29.svg.png"/>
        </button>
        <button disabled={loading} onClick={slackOauth} className='button' style={{borderRadius:'50%',padding:'0.5rem'}}>
          <img height={20} width={20} src="https://cdn.worldvectorlogo.com/logos/slack-new-logo.svg"/>
        </button>
        <button disabled={loading} className='button' style={{borderRadius:'50%',padding:'0.5rem'}}>
          <img height={20} width={20} src="https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Google_Sheets_logo_%282014-2020%29.svg/98px-Google_Sheets_logo_%282014-2020%29.svg.png"/>
        </button>
      </div>
      {data.length > 0 
      ? 
      <>
        <div className="summary-scroll">
        <div className='progress'></div>
          <Markdown className="markdown">
            {data.join(' ')}
          </Markdown>
        </div>
      </>
      :
      <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height:loading ? '70vh' : 'auto',
          width:'100%',
          padding:'0.8rem',
          marginTop: '1rem'
      }}>
        {loading ? <BardLogo /> : <LandingPage />}
      </div>
      }
    </div>
  )
}