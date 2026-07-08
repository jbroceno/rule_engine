use open_pre
go


declare @fecha int =

delete p
from MRO_MOTORPARAM p
inner join MRO_MOTORFECHA f on f.MOTORFECHA_ID=p.MOTORFECHA_ID
where f.MOTORFECHA_ID=@fecha

delete a 
from MRO_MOTORACCION a
inner join MRO_MOTORREGLA r on r.MOTORREGLA_ID=a.MOTORREGLA_ID
inner join MRO_MOTORFECHA f on f.MOTORFECHA_ID=r.MOTORFECHA_ID
where f.MOTORFECHA_ID=@fecha

delete c
from MRO_MOTORCONDICION c
inner join MRO_MOTORREGLA r on r.MOTORREGLA_ID=c.MOTORREGLA_ID
inner join MRO_MOTORFECHA f on f.MOTORFECHA_ID=r.MOTORFECHA_ID
where f.MOTORFECHA_ID=@fecha

delete r 
from MRO_MOTORREGLA r 
inner join MRO_MOTORFECHA f on r.MOTORFECHA_ID=f.MOTORFECHA_ID
where f.MOTORFECHA_ID=@fecha

delete from [MRO_MOTORFECHA] where motorfecha_id=@fecha
