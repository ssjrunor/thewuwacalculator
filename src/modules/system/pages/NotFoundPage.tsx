/*
  Author: Runor Ewhro
  Description: renders the not found page.
*/

import { useNavigate } from 'react-router-dom'
import {TbGoGame} from "react-icons/tb";

export function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="page not-found-page">
      <div className="not-found-center">
        <div className="not-found-code">404</div>

        <img
          src="https://media1.tenor.com/m/lx5lgBZWxucAAAAC/sparkle-sparxie.gif"
          alt=""
          className="not-found-gif"
        />

        <p className="not-found-message">What were you looking for...?.</p>

        <button type="button" className="page-back-btn" title={'Calculator'} onClick={() => navigate('/calculator')}>
          <TbGoGame size={14} />
        </button>
      </div>
    </div>
  )
}
