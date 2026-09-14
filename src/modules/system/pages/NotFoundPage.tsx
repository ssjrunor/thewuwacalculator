/*
  Author: Runor Ewhro
  Description: renders the not found page.
*/

import { useNavX } from '@/app/nav/useNavX'
import {TbGoGame} from "react-icons/tb";

export function NotFoundPage() {
  const navigate = useNavX()
  const parts = window.location.pathname.split('/').filter(Boolean);

  return (
    <div className="page not-found-page">
      <div className="not-found-center">
        <div className="not-found-code">404</div>

        <img
          src="https://media1.tenor.com/m/lx5lgBZWxucAAAAC/sparkle-sparxie.gif"
          alt="" className="not-found-gif"
        />

        <p className="not-found-message">{`${parts.length > 1 ? `${parts[0]}... ${parts[1]}..?` : `${parts[0]}..?`} Son.. what's that supposed to mean..?`}.</p>

        <button type="button" className="page-back-btn" title={'Calculator'} onClick={() => navigate('/calculator')}>
          <TbGoGame size="0.875rem" />
        </button>
      </div>
    </div>
  )
}
