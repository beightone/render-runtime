import React, { Component } from 'react'
import ErrorImg from './images/error-img.png'
import VtexLogo from './images/vtex-logo.png'

import './error.global.css'

const toSplunkLink = (rid: string) =>
  `https://splunk7.vtex.com/en-US/app/vtex_colossus/search?q=search%20index%3Dcolossus%20sender%3Dvtex.render-server%40*%20body.requestId%3D${rid}&display.page.search.mode=verbose&dispatch.sample_ratio=1&earliest=-5m%40m&latest=now`
export default class ErrorPage extends Component {
  public state = { enabled: false }
  private splunk = 0

  public componentDidMount() {
    setTimeout(()=>{this.setState({enabled: true})} , 5000)
  }

  public render() {
    const date = new Date()
    return (
      <div className="h-100 flex flex-column justify-between mh6 mh0-ns">
        <div></div>
        <div>
          <div className="flex justify-center-ns flex-row-ns flex-column-reverse h-auto-ns pt6 pt0-ns">
            <div className="mr9-ns mr0">
              <div className="f2 c-on-base">Something went wrong</div>
              <div className="f5 pt5 c-on-base lh-copy">
                <div>There was a techinical problem loading this page.</div>
                <div> Try refreshing the page or come back in 5 minutes.</div>
              </div>
              <div className="f6 pt5 c-muted-2" style={{fontFamily: 'courier, code'}}>
                <div>ID: {window.__REQUEST_ID__}</div>
                <div className="f6 c-muted-2 lh-copy fw7">{date.toUTCString()}</div>
              </div>
              <div className="pt7">
                <button className={'bw1 ba fw5 ttu br2 fw4 v-mid relative pv4 ph6 f5 ' + (this.state.enabled ? 'bg-action-primary b--action-primary c-on-action-primary hover-bg-action-primary hover-b--action-primary hover-c-on-action-primary pointer' : 'bg-disabled b--disabled c-on-disabled')} disabled={!this.state.enabled} onClick={ ()=>{window.location.reload()}}>Refresh</button>
              </div>
            </div>
            <div>
              <img src={ErrorImg} onClick={this.handleImageClick} className="img-height pb6 pb0-ns"></img>
            </div>
          </div>
        </div>
        <div className="pb8-ns pb6 flex-ns justify-center-ns pt6 pt0-ns">
          <img src={VtexLogo} className="w-auto"></img>
        </div>
      </div>
    )
  }

  private handleImageClick = () => {
    if (this.splunk < 2) {
      this.splunk = this.splunk + 1
    } else {
      window.open(toSplunkLink(window.__REQUEST_ID__), '_blank')
      this.splunk = 0
    }
  }
}